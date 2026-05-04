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

  # Workflow must (a) use GITHUB_TOKEN AND (b) push to a deploy branch
  uses_github_token=$(grep -c "secrets.GITHUB_TOKEN" "$f" || true)
  pushes_to_deploy=$(grep -cE 'git push origin (staging|main|production|develop)' "$f" || true)

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

echo ""
if [ "$PROBLEMS" -eq 0 ]; then
  echo "✓ No workflow integrity issues found"
  exit 0
fi
echo "::error::Found $PROBLEMS workflow integrity issue(s). Fix before merging."
exit 1
