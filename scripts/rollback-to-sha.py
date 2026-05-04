#!/usr/bin/env python3
"""
BUGS-9: SHA-verified Vercel production rollback.

Replaces the previous broken `vercel ls --json | filter target=production` parser
that produced false-positive "rolled back successfully" messages while doing
nothing (see run 25324541577).

Inputs come from environment variables (workflow-friendly):

    TARGET_SHA       — git SHA we want production to be on after rollback.
                       Typically the value of `main` BEFORE the merge that
                       triggered the failed smoke test, captured at the
                       start of promote-to-production.yml.
    VERCEL_TOKEN     — Vercel API token (read + promote scope).
    VERCEL_ORG_ID    — Vercel team / scope ID.
    VERCEL_PROJECT_ID — Vercel project ID.

Behaviour:

    1. Find the previous production deployment matching `TARGET_SHA`
       via the Vercel REST API. Match on `meta.githubCommitSha`.
    2. POST /v13/deployments/<uid>/promote to promote that deployment.
       (No `vercel rollback`/CLI dependency — direct API call, deterministic.)
    3. Poll the deployments API until the current production deployment's
       `meta.githubCommitSha` equals `TARGET_SHA`. Up to ~60s.
    4. Print a step summary and exit 0.

Any failure (target SHA not found, promote API errors, verification
timeout, verification SHA mismatch) prints `::error::` and exits non-zero.
No silent success paths.

Pure logic (find_target / parse_current_sha / format_summary) lives at module
level and is unit-tested in tests/unit/rollback-to-sha.test.js — the network
calls are wrapped in main().
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from typing import Optional


VERCEL_API = "https://api.vercel.com"


# ---------------------------------------------------------------------------
# Pure functions (unit-testable, no network)
# ---------------------------------------------------------------------------

def find_target(deployments_response: dict, target_sha: str) -> Optional[dict]:
    """Return the first production deployment whose githubCommitSha equals
    target_sha, or None. Expects the JSON shape returned by
    GET /v6/deployments?target=production.
    """
    if not target_sha:
        return None
    for d in deployments_response.get("deployments", []):
        meta = d.get("meta") or {}
        if meta.get("githubCommitSha") == target_sha:
            return d
    return None


def parse_current_sha(deployments_response: dict) -> Optional[str]:
    """Return the SHA of the most recent production deployment, or None.
    Used after a promote to verify production now serves the expected SHA.
    """
    deployments = deployments_response.get("deployments") or []
    if not deployments:
        return None
    meta = deployments[0].get("meta") or {}
    return meta.get("githubCommitSha")


def format_summary(target_sha: str, deployment_uid: str, deployment_url: str) -> str:
    """Step summary on success."""
    return (
        "## ⚠️ Auto-Rollback Executed\n"
        "\n"
        f"- Target SHA: `{target_sha[:8]}`\n"
        f"- Promoted deployment: `{deployment_uid}`\n"
        f"- URL: https://{deployment_url}\n"
        "- Verified: production now serves the target SHA\n"
    )


# ---------------------------------------------------------------------------
# Network wrappers
# ---------------------------------------------------------------------------

def _request(method: str, path: str, token: str, body: Optional[dict] = None) -> dict:
    url = f"{VERCEL_API}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    if body is not None:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def list_production_deployments(token: str, project_id: str, team_id: str, limit: int = 20) -> dict:
    return _request(
        "GET",
        f"/v6/deployments?projectId={project_id}&teamId={team_id}&target=production&limit={limit}",
        token,
    )


def promote_deployment(token: str, team_id: str, deployment_uid: str) -> dict:
    return _request(
        "POST",
        f"/v10/projects/{os.environ['VERCEL_PROJECT_ID']}/promote/{deployment_uid}?teamId={team_id}",
        token,
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> int:
    target_sha = os.environ.get("TARGET_SHA", "").strip()
    token = os.environ.get("VERCEL_TOKEN", "").strip()
    team_id = os.environ.get("VERCEL_ORG_ID", "").strip()
    project_id = os.environ.get("VERCEL_PROJECT_ID", "").strip()

    if not all([target_sha, token, team_id, project_id]):
        print("::error::Missing one of TARGET_SHA, VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID")
        return 1

    print(f"Target SHA: {target_sha} (looking up matching production deployment…)")

    # Step 1: find the deployment matching TARGET_SHA
    try:
        listing = list_production_deployments(token, project_id, team_id, limit=20)
    except urllib.error.HTTPError as e:
        print(f"::error::Vercel API list failed: {e.code} {e.reason}")
        return 1

    target = find_target(listing, target_sha)
    if target is None:
        print(f"::error::No production deployment found with meta.githubCommitSha={target_sha}")
        print("Recent production deployments seen:")
        for d in listing.get("deployments", [])[:5]:
            sha = ((d.get("meta") or {}).get("githubCommitSha") or "?")[:8]
            print(f"  - uid={d.get('uid')} sha={sha} state={d.get('readyState')}")
        return 1

    uid = target.get("uid")
    deployment_url = target.get("url", "")
    print(f"Found target deployment: uid={uid} url=https://{deployment_url}")

    # Step 2: promote it
    try:
        promote_deployment(token, team_id, uid)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"::error::Vercel promote API call failed: {e.code} {e.reason}")
        print(body)
        return 1

    print(f"Promote requested for {uid}; verifying production SHA…")

    # Step 3: verify production now serves TARGET_SHA
    deadline = time.time() + 60
    last_seen_sha: Optional[str] = None
    while time.time() < deadline:
        time.sleep(5)
        try:
            verify_listing = list_production_deployments(token, project_id, team_id, limit=1)
        except urllib.error.HTTPError as e:
            print(f"  verify: API error {e.code} {e.reason}, retrying…")
            continue
        last_seen_sha = parse_current_sha(verify_listing)
        if last_seen_sha == target_sha:
            print(f"::notice::Verified — production deployment is now {target_sha[:8]}")
            summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
            if summary_path:
                with open(summary_path, "a") as f:
                    f.write(format_summary(target_sha, uid, deployment_url))
            return 0
        seen = (last_seen_sha or "?")[:8]
        print(f"  verify: production currently {seen} (want {target_sha[:8]})")

    print(
        f"::error::Rollback verification timed out. "
        f"Production deployment SHA is {last_seen_sha or 'unknown'}, "
        f"expected {target_sha}. The promote API call may have failed silently."
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
