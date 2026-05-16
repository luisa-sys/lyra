#!/usr/bin/env python3
"""
Phantom check_suite cleanup — BUGS-16 follow-up.

Background
----------
The Vercel GitHub App (and historically Supabase's) post a `check_suite`
on every push to the repo. Sometimes the app receives the webhook but
decides "nothing to do" and never creates any check runs under the suite
— leaving it permanently `status: queued, latest_check_runs_count: 0`.

GitHub's auto-merge feature can occasionally wait on these phantom
suites, blocking PRs that have all required checks passing. We've fixed
the worst case (BUGS-16 — release pipeline now direct-merges so no PR is
involved) but the cosmetic phantoms still accumulate and create noise.

What this script does
---------------------
1. For each branch HEAD we care about (configurable via --branches),
   list `check_suites` via the GitHub REST API.
2. Filter to phantoms — `status == 'queued' AND latest_check_runs_count == 0`,
   from apps in the configured "stuck-prone" allow-list (currently just
   `vercel`).
3. POST `/rerequest` to each phantom. Per GitHub docs, this re-sends the
   webhook to the owning app. The app then either (a) re-posts a phantom
   (no worse than before), (b) marks the suite `neutral` or `success`
   (best case), or (c) ignores it again. Either way we surface the count.
4. Report a summary as `::warning::` (1+ phantoms found) or `::notice::`
   (clean) so the workflow run is searchable.

Why not just delete the suite?
------------------------------
GitHub doesn't allow deleting check_suites via API. Only the owning app
can mutate its own suites. Rerequest is the only available lever.

Usage
-----
    cleanup-phantom-check-suites.py
        --repo luisa-sys/lyra
        --branches develop main staging beta
        --token "$GITHUB_TOKEN"
        [--apps vercel]
        [--dry-run]

Exits non-zero only on API/network failure. Finding phantoms is the
expected steady state, not an error.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any


GITHUB_API = "https://api.github.com"


def gh_request(
    method: str,
    path: str,
    token: str,
    body: Any | None = None,
) -> tuple[int, Any]:
    """Tiny stdlib-only GitHub API client.

    Returns (status_code, parsed_body). On 204 No Content the body is
    None. Raises urllib.error.URLError on network failure.
    """
    url = f"{GITHUB_API}{path}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "lyra-cleanup-phantom-check-suites/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            status = resp.status
            raw = resp.read().decode("utf-8") if resp.length != 0 else ""
            return status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        # The API uses 422 for "no permission to rerequest", 404 for
        # not-found, etc. We treat these as data rather than exceptions.
        try:
            body_text = e.read().decode("utf-8")
        except Exception:
            body_text = ""
        return e.code, (json.loads(body_text) if body_text else None)


def get_branch_head_sha(repo: str, branch: str, token: str) -> str | None:
    status, body = gh_request("GET", f"/repos/{repo}/branches/{branch}", token)
    if status != 200 or not isinstance(body, dict):
        return None
    return body.get("commit", {}).get("sha")


def list_check_suites(repo: str, sha: str, token: str) -> list[dict[str, Any]]:
    status, body = gh_request(
        "GET", f"/repos/{repo}/commits/{sha}/check-suites?per_page=100", token
    )
    if status != 200 or not isinstance(body, dict):
        return []
    return list(body.get("check_suites", []))


def rerequest_check_suite(repo: str, suite_id: int, token: str) -> tuple[int, Any]:
    return gh_request(
        "POST", f"/repos/{repo}/check-suites/{suite_id}/rerequest", token
    )


def is_phantom(suite: dict[str, Any], target_apps: set[str]) -> bool:
    """A phantom check_suite: queued status, zero runs, from a known
    stuck-prone app (currently just 'vercel').
    """
    return (
        suite.get("status") == "queued"
        and suite.get("latest_check_runs_count", 0) == 0
        and (suite.get("app") or {}).get("slug") in target_apps
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--repo", required=True, help="GitHub repo in owner/name form."
    )
    parser.add_argument(
        "--branches",
        nargs="+",
        required=True,
        help="Branch names to scan (HEAD of each).",
    )
    parser.add_argument(
        "--token",
        default=os.environ.get("GITHUB_TOKEN"),
        help="GitHub token (defaults to $GITHUB_TOKEN).",
    )
    parser.add_argument(
        "--apps",
        nargs="+",
        default=["vercel"],
        help="GitHub App slugs to treat as phantom-prone.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report findings but don't POST rerequest.",
    )
    args = parser.parse_args()

    if not args.token:
        print(
            "::error::No GitHub token supplied (--token or $GITHUB_TOKEN).",
            file=sys.stderr,
        )
        return 2

    target_apps = set(args.apps)
    total_phantoms = 0
    total_rerequested = 0
    total_failed = 0
    per_branch_findings: list[str] = []

    for branch in args.branches:
        sha = get_branch_head_sha(args.repo, branch, args.token)
        if not sha:
            print(f"::warning::Could not resolve HEAD SHA for branch '{branch}'")
            continue

        suites = list_check_suites(args.repo, sha, args.token)
        phantoms = [s for s in suites if is_phantom(s, target_apps)]
        total_phantoms += len(phantoms)

        if not phantoms:
            per_branch_findings.append(f"  - {branch}@{sha[:8]}: clean")
            continue

        per_branch_findings.append(
            f"  - {branch}@{sha[:8]}: {len(phantoms)} phantom(s)"
        )

        for suite in phantoms:
            suite_id = suite.get("id")
            app_slug = (suite.get("app") or {}).get("slug", "?")
            if args.dry_run:
                print(
                    f"  [dry-run] would rerequest {app_slug} suite {suite_id} "
                    f"on {branch}@{sha[:8]}"
                )
                continue

            status, _body = rerequest_check_suite(args.repo, suite_id, args.token)
            if 200 <= status < 300:
                total_rerequested += 1
                print(
                    f"  rerequested {app_slug} suite {suite_id} "
                    f"on {branch}@{sha[:8]} (HTTP {status})"
                )
            else:
                total_failed += 1
                print(
                    f"::warning::rerequest failed for {app_slug} suite "
                    f"{suite_id} on {branch}@{sha[:8]} — HTTP {status}"
                )

    # Summary — `::notice::` for visibility in the run summary.
    print("\n=== phantom check_suite cleanup summary ===")
    for line in per_branch_findings:
        print(line)
    print(
        f"\nTotal phantoms found:  {total_phantoms}"
        f"\nTotal rerequested:     {total_rerequested}"
        f"\nTotal rerequest failed: {total_failed}"
    )

    # Always exit 0 — finding phantoms is expected steady state, not an
    # error. Only API/network failures (caught above) would warrant a
    # non-zero exit, and those already returned 2.
    return 0


if __name__ == "__main__":
    sys.exit(main())
