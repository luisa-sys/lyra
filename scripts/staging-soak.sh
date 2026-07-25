#!/usr/bin/env bash
#
# staging-soak.sh — deterministic HTTP + latency soak of the PROMOTED staging
# environment (KAN-412). Covers layers C1 (public/edge), C2 (authenticated
# surface, with the Vercel bypass header) and C4 (sustained latency) of the
# release contract in docs/STAGING_SOAK_ROUTINE.md. The read-write journey (C3),
# DB drift (C5) and error budget (C6) are driven by the routine agent, not here.
#
# Output: one tab-separated line per probe — "<STATUS>\t<id>\t<description>" —
# STATUS ∈ PASS | FAIL | UNVERIFIED. A host we cannot reach, or a check that
# needs the Vercel bypass we were not given, is UNVERIFIED — never a silent green
# PASS and never a false FAIL (Workflow & Backup Integrity Policy).
#
# Exit: 2 if any FAIL; 1 if any UNVERIFIED and no FAIL; 0 if all PASS.
#
# Portability: no `mapfile`/`readarray` (absent in macOS bash 3.2); no `set -e`
# (we run EVERY probe and aggregate — nothing silently swallowed).
set -uo pipefail

SITE="${STAGE_SITE:-https://stage.checklyra.com}"
CURL_MAX_TIME="${CURL_MAX_TIME:-20}"
PASSES="${SOAK_PASSES:-5}"            # C4: probe each latency route N times
PAGE_BUDGET_MS="${PAGE_BUDGET_MS:-2500}"
HEALTH_BUDGET_MS="${HEALTH_BUDGET_MS:-800}"
UA="Mozilla/5.0 (compatible; LyraStagingSoak/1.0; +https://checklyra.com)"

# The Vercel deployment-protection bypass reaches protected staging pages. When
# absent, we can only confirm "the gate is up"; every content/latency check is
# then UNVERIFIED (we cannot reach real pages) — never a silent skip.
BYPASS="${VERCEL_AUTOMATION_BYPASS:-}"
# Optional Cloudflare WAF-skip header pair (docs/E2E_AUTHED_CF_BYPASS.md).
CF_HEADER="${E2E_CF_BYPASS_HEADER:-}"
CF_SECRET="${E2E_CF_BYPASS_SECRET:-}"

# Header args, built ONCE. Always carries the UA so the array is never empty
# (bash 3.2 errors on empty-array expansion under `set -u`).
CURL_HDRS=(-A "$UA")
[ -n "$BYPASS" ] && CURL_HDRS+=(-H "x-vercel-protection-bypass: $BYPASS")
[ -n "$CF_HEADER" ] && [ -n "$CF_SECRET" ] && CURL_HDRS+=(-H "$CF_HEADER: $CF_SECRET")

PASS=0; FAIL=0; UNV=0
record() { # $1=STATUS $2=id $3..=description
  local status="$1" id="$2"; shift 2
  printf '%s\t%s\t%s\n' "$status" "$id" "$*"
  case "$status" in
    PASS)       PASS=$((PASS+1)) ;;
    FAIL)       FAIL=$((FAIL+1)) ;;
    UNVERIFIED) UNV=$((UNV+1)) ;;
  esac
}

http_code() { # <url> → status code (000 on transport failure); sends bypass/CF headers
  curl -so /dev/null -w '%{http_code}' --max-time "$CURL_MAX_TIME" "${CURL_HDRS[@]}" "$1" 2>/dev/null || echo "000"
}
time_ms() { # <url> → total time in integer ms, or empty on failure
  local t
  t=$(curl -so /dev/null -w '%{time_total}' --max-time "$CURL_MAX_TIME" "${CURL_HDRS[@]}" "$1" 2>/dev/null) || return 1
  awk -v s="$t" 'BEGIN{ printf("%d", s*1000) }'
}
median() { printf '%s\n' "$@" | sort -n | awk '{a[NR]=$0} END{ if(NR%2){print a[(NR+1)/2]} else {print int((a[NR/2]+a[NR/2+1])/2)} }'; }
maxv()   { printf '%s\n' "$@" | sort -n | tail -1; }

# expect_code <id> <url> <desc> <code...>  — PASS if actual ∈ codes; a lone 403
# where 403 was not accepted is UNVERIFIED (CF challenge); 000 UNVERIFIED; else FAIL.
expect_code() {
  local id="$1" url="$2" desc="$3"; shift 3
  local actual c; actual=$(http_code "$url")
  for c in "$@"; do [ "$actual" = "$c" ] && { record PASS "$id" "$desc ($actual)"; return; }; done
  case "$actual" in
    403)                 record UNVERIFIED "$id" "$desc — 403 (Cloudflare challenge / bot-block; expected ${*}). See docs/E2E_AUTHED_CF_BYPASS.md" ;;
    000)                 record UNVERIFIED "$id" "$desc — unreachable (000)" ;;
    301|302|303|307|308) record UNVERIFIED "$id" "$desc — redirected ($actual) instead of ${*}; still gated or bypass not honoured — confirm" ;;
    *)                   record FAIL "$id" "$desc — got $actual, expected one of: ${*}" ;;
  esac
}

# latency_probe <id> <path> <budget_ms> <desc>  — C4: N timed passes; PASS if
# reachable AND fewer than 2 passes exceed budget; UNVERIFIED if unreachable.
latency_probe() {
  local id="$1" path="$2" budget="$3" desc="$4"
  local url="${SITE}${path}"
  local over=0 i ms; local samples=()
  for ((i=0; i<PASSES; i++)); do
    ms=$(time_ms "$url") || ms=""
    [ -z "$ms" ] && { record UNVERIFIED "$id" "$desc — pass $((i+1))/$PASSES unreachable"; return; }
    samples+=("$ms")
    [ "$ms" -gt "$budget" ] && over=$((over+1))
  done
  local med mx; med=$(median "${samples[@]}"); mx=$(maxv "${samples[@]}")
  if [ "$over" -ge 2 ]; then
    record FAIL "$id" "$desc — DEGRADED: p50=${med}ms max=${mx}ms, $over/$PASSES over ${budget}ms"
  else
    record PASS "$id" "$desc — p50=${med}ms max=${mx}ms (budget ${budget}ms, $over/$PASSES over)"
  fi
}

echo "# Lyra staging soak — $(date -u '+%Y-%m-%dT%H:%M:%SZ') — target $SITE"

# ── C1 gate: root must be REACHABLE and GATED (never the full app anonymously) ─
# This probe deliberately sends NO bypass header — it is testing the gate itself.
root=$(curl -so /dev/null -w '%{http_code}' --max-time "$CURL_MAX_TIME" -A "$UA" "$SITE/" 2>/dev/null || echo "000")
case "$root" in
  301|302|303|307|308|401|403) record PASS       "C1-gate" "staging root reachable + gated ($root)" ;;
  200)                          record UNVERIFIED "C1-gate" "staging root served 200 ANONYMOUSLY — confirm this is an intended public page, not the app exposed" ;;
  000)                          record UNVERIFIED "C1-gate" "staging root unreachable (000)" ;;
  5??|50?|52?|53?)              record FAIL       "C1-gate" "staging root error ($root)" ;;
  *)                            record UNVERIFIED "C1-gate" "staging root unexpected code $root" ;;
esac

if [ -z "$BYPASS" ]; then
  # Honest degradation: every content/latency check needs the bypass to reach
  # protected staging pages. One UNVERIFIED line, not a wall of false FAILs.
  record UNVERIFIED "C1-content" "public-page + /api/health conformance need VERCEL_AUTOMATION_BYPASS (staging is protection-gated) — not run"
  record UNVERIFIED "C2-C4"      "authenticated-surface + latency need VERCEL_AUTOMATION_BYPASS — not run"
else
  # ── C1 content (with bypass): the pages behind the gate ──────────────────
  expect_code "C1-status"  "$SITE/status"                   "status page"  200
  expect_code "C1-robots"  "$SITE/robots.txt"               "robots.txt"   200 403 401
  expect_code "C1-sitemap" "$SITE/sitemap.xml"              "sitemap.xml"  200 403 401
  expect_code "C1-sectxt"  "$SITE/.well-known/security.txt" "security.txt" 200 403 401

  # ── C1 release-conformance: /api/health JSON must match THIS env ─────────
  body=$(curl -s --max-time "$CURL_MAX_TIME" "${CURL_HDRS[@]}" "$SITE/api/health" 2>/dev/null)
  if [ -z "$body" ]; then
    record UNVERIFIED "C1-health" "/api/health empty/unreachable"
  elif ! printf '%s' "$body" | jq -e . >/dev/null 2>&1; then
    record UNVERIFIED "C1-health" "/api/health did not return JSON (protection challenge?)"
  else
    problems=""
    [ "$(printf '%s' "$body" | jq -r '.ok')" = "true" ]                          || problems+="ok!=true; "
    [ "$(printf '%s' "$body" | jq -r '.siteUrl // empty')" = "https://stage.checklyra.com" ] || problems+="siteUrl wrong; "
    [ "$(printf '%s' "$body" | jq -r '.isBetaDeploy')" = "false" ]               || problems+="isBetaDeploy!=false; "
    [ "$(printf '%s' "$body" | jq -r '.vercelEnv // empty')" = "preview" ]        || problems+="vercelEnv!=preview; "
    if [ -n "$problems" ]; then
      record FAIL "C1-health" "release-conformance mismatch: $problems(body: $(printf '%s' "$body" | head -c 160))"
    else
      record PASS "C1-health" "/api/health conformant (ok, siteUrl, isBetaDeploy=false, vercelEnv=preview)"
    fi
  fi

  # ── C2/C4: sustained latency on the surface behind the gate ──────────────
  latency_probe "C4-home"   "/"           "$PAGE_BUDGET_MS"   "home page"
  latency_probe "C4-login"  "/login"      "$PAGE_BUDGET_MS"   "login page"
  latency_probe "C4-signup" "/signup"     "$PAGE_BUDGET_MS"   "signup page"
  latency_probe "C4-join"   "/join"       "$PAGE_BUDGET_MS"   "join (invite) page"
  latency_probe "C4-status" "/status"     "$PAGE_BUDGET_MS"   "status page"
  latency_probe "C4-health" "/api/health" "$HEALTH_BUDGET_MS" "health endpoint"
fi

echo ""
echo "# Results: PASS=$PASS FAIL=$FAIL UNVERIFIED=$UNV"
if [ "$FAIL" -gt 0 ]; then exit 2; fi
if [ "$UNV" -gt 0 ]; then exit 1; fi
exit 0
