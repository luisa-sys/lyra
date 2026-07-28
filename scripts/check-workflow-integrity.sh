#!/usr/bin/env bash
# scripts/check-workflow-integrity.sh
#
# BUGS-4 / KAN-167: Static analysis of .github/workflows/*.yml for
# known-bad patterns that produce false-positive "success" while doing
# nothing. Failing checks here means a workflow can silently lie about
# what it did.
#
# Run as part of pr-checks.yml so any PR that reintroduces these
# patterns fails CI.
#
# Patterns checked:
#
#   1. GITHUB_TOKEN used to push to a deploy branch.
#      Per https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication
#      "events triggered by the GITHUB_TOKEN will not create a new
#      workflow run." So a workflow that uses GITHUB_TOKEN to push to
#      staging/main will silently fail to trigger downstream deploy
#      workflows. Use a PAT (e.g. LYRA_RELEASE_PAT) instead.
#
#   2. `gh run list ... --limit 1` to verify a deploy succeeded.
#      Without filtering by headSha, this matches any recent run on
#      the branch — including stale runs from other commits.
#
#   3. `if [ "$STATUS" = "200" ] || [ "$STATUS" = "401" ]` style
#      health checks for staging/production sites without verifying
#      the deployed SHA. 401 (Vercel SSO) is returned regardless of
#      what's deployed, so it tells us nothing about success.
#
# Each pattern can be allow-listed by including a justification comment
# directly above the offending line containing the marker `# integrity-ok:`.
# Allow-list use is intentional and rare; the marker should explain
# WHY this is safe (e.g. "no downstream workflow watches this branch").

set -euo pipefail

WORKFLOW_DIR=".github/workflows"
PROBLEMS=0

# Count matches in a file, setting MATCH_COUNT. `grep -c` exits 1 on zero
# matches (printing "0") but >=2 when the search itself fails (printing
# nothing) — so a bare `|| true` collapses "this file is clean" and "we could
# not read this file" into the same empty string. Exit 2 = could not verify.
MATCH_COUNT=0
count_matches() {
  local f="$1"; shift
  local out rc
  if out="$(grep -c "$@" -- "$f" 2>&1)"; then rc=0; else rc=$?; fi
  if [ "$rc" -gt 1 ]; then
    echo "::error::check-workflow-integrity: could not scan ${f} (grep exit ${rc}): ${out}"
    echo "::error::  Failing closed (exit 2) rather than clearing a workflow that was never read."
    exit 2
  fi
  MATCH_COUNT="${out:-0}"
}

if [ ! -d "$WORKFLOW_DIR" ]; then
  echo "::error::No $WORKFLOW_DIR directory found"
  exit 1
fi

echo "Scanning $WORKFLOW_DIR for known false-positive patterns..."
echo ""

# ── Pattern 1: GITHUB_TOKEN + git push to deploy branch ──
# Matches `git push origin (staging|main|production)` in any workflow that
# also references `secrets.GITHUB_TOKEN` for the checkout step.
for f in "$WORKFLOW_DIR"/*.yml; do
  [ -f "$f" ] || continue
  basename=$(basename "$f")

  # Workflow must (a) use GITHUB_TOKEN AND (b) push to a deploy branch.
  # `grep -c` exits 1 on zero matches (printing "0") but >=2 when the search
  # itself fails, printing nothing — and a bare `|| true` collapses that into an
  # empty string, i.e. "no GITHUB_TOKEN here", silently clearing the workflow.
  # This gate exists because that exact false-green cost ~32 days of dead
  # promotes (BUGS-4). Count it properly; an unreadable workflow file is exit 2.
  # NB: called as plain commands, not inside $( ) — a subshell's exit 2 would
  # only leave the subshell and the scan would carry on regardless.
  count_matches "$f" -F "secrets.GITHUB_TOKEN"
  uses_github_token=$MATCH_COUNT
  count_matches "$f" -E 'git push origin (staging|main|production|develop)'
  pushes_to_deploy=$MATCH_COUNT

  if [ "$uses_github_token" -gt 0 ] && [ "$pushes_to_deploy" -gt 0 ]; then
    # Verify it isn't allow-listed
    if ! grep -qE '# integrity-ok:.*GITHUB_TOKEN' "$f"; then
      echo "::error file=$f::Pattern 1: uses secrets.GITHUB_TOKEN AND pushes to a deploy branch"
      echo "    GITHUB_TOKEN does NOT trigger downstream workflows on push."
      echo "    Use a PAT (e.g. LYRA_RELEASE_PAT) for the checkout token."
      echo "    Or add '# integrity-ok: <reason>' comment if intentional."
      PROBLEMS=$((PROBLEMS + 1))
    fi
  fi
done

# ── Pattern 2: gh run list --limit 1 to verify a deploy ──
# Matches `gh run list ... --limit 1` followed by checking conclusion.
# Without --json headSha + filtering, this matches stale runs.
for f in "$WORKFLOW_DIR"/*.yml; do
  [ -f "$f" ] || continue

  # Look for `gh run list ... --limit 1` followed within 5 lines by
  # `conclusion` (suggesting it's checking deploy status)
  if grep -B 0 -A 5 'gh run list.*--limit 1' "$f" | grep -q 'conclusion'; then
    # Allow-listed?
    if ! grep -qE '# integrity-ok:.*--limit 1' "$f"; then
      echo "::error file=$f::Pattern 2: 'gh run list ... --limit 1' used to verify deploy without SHA filtering"
      echo "    This matches the most-recent run on the branch regardless of which commit it was for."
      echo "    Use --limit 5 (or more) and filter by headSha == expected SHA."
      echo "    Or add '# integrity-ok: <reason>' comment if intentional."
      PROBLEMS=$((PROBLEMS + 1))
    fi
  fi
done

# ── Pattern 3: health check accepting 401 without SHA verification ──
# A health check that accepts 401 (Vercel SSO) as success without ALSO
# verifying the deployed SHA matches the expected SHA. The check itself
# is fine; it's the absence of a SHA verification step in the same job
# that's the problem.
#
# This is harder to detect statically — we look for jobs that have
# `[ "$STATUS" = "401" ]` AND don't have any `githubCommitSha` or
# `Vercel API` reference in the same job.
for f in "$WORKFLOW_DIR"/*.yml; do
  [ -f "$f" ] || continue

  if grep -qE '\[ "\$STATUS" = "401" \]' "$f"; then
    # Does the same file ALSO query the Vercel API for SHA verification?
    if ! grep -qE 'githubCommitSha|api\.vercel\.com' "$f"; then
      # Allow-listed?
      if ! grep -qE '# integrity-ok:.*401' "$f"; then
        echo "::error file=$f::Pattern 3: accepts HTTP 401 in health check without verifying deployed SHA via Vercel API"
        echo "    Vercel SSO returns 401 regardless of which build is deployed, so 401 alone proves nothing."
        echo "    Either query api.vercel.com for githubCommitSha, OR add '# integrity-ok: <reason>'."
        PROBLEMS=$((PROBLEMS + 1))
      fi
    fi
  fi
done

# ── Pattern 4: rollback / promote step swallowing errors with `|| echo ::warning::` ──
# BUGS-9: the previous auto-rollback step in promote-to-production.yml ran
# `vercel promote ... || echo "::warning::..."` which converted a real CLI
# failure into a step-summary lie. Any rollback/promote line that ORs into
# `echo "::warning::"` (or `echo "::notice::"`) hides the failure from the job
# status. Use `|| { echo ::error:: ; exit 1 ; }` if you really need a custom
# message — never `|| echo ::warning::` on a critical action.
for f in "$WORKFLOW_DIR"/*.yml; do
  [ -f "$f" ] || continue

  # Match: `vercel ... || echo "::warning::..."` OR `... promote ... || echo "::warning::..."`
  if grep -nE '(vercel|promote|rollback).*\|\|[[:space:]]*echo[[:space:]]+"::(warning|notice)::' "$f" >/tmp/rb_hits 2>/dev/null && [ -s /tmp/rb_hits ]; then
    if ! grep -qE '# integrity-ok:.*rollback' "$f"; then
      while IFS= read -r hit; do
        echo "::error file=$f::Pattern 4: rollback/promote step swallows error with '|| echo ::warning/notice::' — produces false-positive success → $hit"
      done < /tmp/rb_hits
      echo "    Use '|| { echo ::error:: ; exit 1 ; }', or invoke a script with set -euo pipefail."
      echo "    Or add '# integrity-ok: rollback <reason>' if genuinely advisory."
      PROBLEMS=$((PROBLEMS + 1))
    fi
  fi
done
rm -f /tmp/rb_hits

# ── Pattern 5: prod-promote merge-to-main gate (SEC-86 Finding A) ──
# The beta -> main promote merge is the highest-blast-radius, effectively
# irreversible action in the project. Two invariants must hold for any
# workflow that runs `git push origin main`:
#
#   (5a) A reviewer/approval checkpoint on the merge itself. The merge job
#        must declare `environment: production` (the GitHub Environment where
#        required-reviewers attach) OR the residual "the merge lands before
#        any reviewer" must be an EXPLICIT, documented decision — allow-listed
#        with `# integrity-ok: sec-86 <reason>`. Without one of these, the
#        merge can be landed on main by anyone with repo write who types the
#        confirm string, with no second pair of eyes. The reviewer gate that
#        DOES exist today (production Environment) is referenced only by the
#        downstream deploy-production.yml, which runs AFTER the merge, so it
#        guards the deploy, not the merge. See
#        docs/RELEASE_POLICY.md -> "Release-flow gate (SEC-86 Finding A)".
#
#   (5b) The typed-confirm compensating control must be preserved. The
#        workflow must still gate on `inputs.confirm == "PRODUCTION"`. That
#        typed confirmation is the ONE gate that currently guards the merge;
#        a change that silently removes it (leaving the merge with no gate at
#        all) must fail CI. This half is decision-neutral — it only pins an
#        existing control and never blocks a future upgrade to a real
#        reviewer gate.
for f in "$WORKFLOW_DIR"/*.yml; do
  [ -f "$f" ] || continue

  if grep -qE 'git push origin main([^a-zA-Z0-9_-]|$)' "$f"; then
    # (5a) reviewer checkpoint OR documented residual
    if ! grep -qE '^[[:space:]]*environment:[[:space:]]*production' "$f" \
       && ! grep -qiE '# integrity-ok:.*sec-86' "$f"; then
      echo "::error file=$f::Pattern 5a: pushes to main (prod promote) but the merge job has no 'environment: production' reviewer gate and no documented residual."
      echo "    Add 'environment: production' to the merge job so required-reviewers fire BEFORE the merge,"
      echo "    OR document the residual in docs/RELEASE_POLICY.md and allow-list with '# integrity-ok: sec-86 <reason>'."
      PROBLEMS=$((PROBLEMS + 1))
    fi

    # (5b) typed-confirm compensating control must survive
    if ! grep -qE 'inputs\.confirm' "$f" || ! grep -qE '"PRODUCTION"' "$f"; then
      echo "::error file=$f::Pattern 5b: pushes to main but the typed-confirm gate (inputs.confirm == \"PRODUCTION\") is missing or weakened."
      echo "    The typed confirmation is the sole gate on the irreversible beta->main merge — it must not be removed."
      PROBLEMS=$((PROBLEMS + 1))
    fi
  fi
done

# ── Pattern 6: broad long-lived PAT pushing to main (SEC-66 / separation-of-duties) ──
# Sibling of Pattern 5 on the SAME merge-and-push job. The beta -> main promote
# pushes with LYRA_RELEASE_PAT — a long-lived, broad token (Contents +
# Workflows: write). A push authenticated by that PAT structurally bypasses
# branch protection on main: whoever (or whatever) holds the token can write
# review-free to prod `main` and to workflow definitions across branches. That
# is the separation-of-duties gap SEC-66 tracks.
#
# The *real* fix is a credential/repo-settings change that is Luisa's call:
# migrate to a short-lived, fine-grained GitHub App installation token (or an
# expiring fine-grained PAT with minimal repo selection) and run the promote
# from a protected Environment with a required reviewer. That cannot be
# expressed in a workflow file alone, so — exactly like Pattern 5a — this check
# is waiver-based and decision-neutral: it does not force a particular fix, it
# only makes the residual EXPLICIT and NON-EXPANDING.
#
# Invariant: any workflow that runs `git push origin main` while referencing
# `secrets.LYRA_RELEASE_PAT` must carry an explicit `# integrity-ok: sec-66`
# waiver documenting the SoD residual. This pins the broad-PAT-to-main path to
# its single audited location (promote-to-production.yml's merge-and-push job)
# and fails CI if a NEW workflow starts pushing to main with the broad PAT
# without that being a documented, reviewed decision.
# See docs/RELEASE_POLICY.md -> "Credential / separation-of-duties residual (SEC-66)".
for f in "$WORKFLOW_DIR"/*.yml; do
  [ -f "$f" ] || continue

  if grep -qE 'git push origin main([^a-zA-Z0-9_-]|$)' "$f" \
     && grep -qE 'secrets\.LYRA_RELEASE_PAT' "$f"; then
    if ! grep -qiE '# integrity-ok:.*sec-66' "$f"; then
      echo "::error file=$f::Pattern 6: pushes to main using the broad long-lived LYRA_RELEASE_PAT, bypassing branch protection, with no documented SoD residual."
      echo "    The push-to-main path must use a short-lived fine-grained token behind a protected Environment (SEC-66),"
      echo "    OR the residual must be documented in docs/RELEASE_POLICY.md and allow-listed with '# integrity-ok: sec-66 <reason>'."
      PROBLEMS=$((PROBLEMS + 1))
    fi
  fi
done

echo ""
if [ "$PROBLEMS" -eq 0 ]; then
  echo "✓ No workflow integrity issues found"
  exit 0
fi
echo "::error::Found $PROBLEMS workflow integrity issue(s). Fix before merging."
exit 1
