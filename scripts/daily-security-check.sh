#!/usr/bin/env bash
#
# daily-security-check.sh — deterministic HTTP/port probes for the daily
# security check (KAN-294 / KAN-296). READ-ONLY. See docs/DAILY_SECURITY_CHECK.md
# for the full routine and docs/DAILY_SECURITY_CHECK_ROUTINE.md for how this is
# driven from a scheduled Claude Code cloud routine.
#
# This script covers ONLY the probes that need nothing but curl + the shell.
# The high-value MCP-tool probes (Supabase get_advisors/SQL, GitHub & Cloudflare
# read APIs) are driven by the agent in the routine — they are NOT in here.
#
# Output: one tab-separated line per probe — "<STATUS>\t<id>\t<description>" —
# where STATUS is PASS | FAIL | UNVERIFIED. A host we cannot reach (egress
# blocked / network down / bot-challenged) is UNVERIFIED, never a silent green
# PASS and never a false FAIL (Workflow & Backup Integrity Policy).
#
# A lone HTTP 403 is treated as "reachable but blocked/challenged" (Cloudflare
# bot protection trips on shared runner IPs — CLAUDE.md gotcha #7), so it is
# UNVERIFIED where a specific non-403 code was expected, never a hard FAIL.
#
# Exit: 2 if any FAIL; 1 if any UNVERIFIED and no FAIL; 0 if all PASS.
#
# NB: `set -e` is intentionally OFF. We run EVERY probe and aggregate the
# result — we must not abort on the first non-zero curl. All errors are handled
# explicitly below; nothing is silently swallowed.
set -uo pipefail

SITE="${LYRA_SITE:-https://checklyra.com}"
MCP="${LYRA_MCP:-https://mcp.checklyra.com}"
CURL_MAX_TIME="${CURL_MAX_TIME:-20}"

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

host_of() { local u="${1#http://}"; u="${u#https://}"; printf '%s' "${u%%/*}"; }
in_list() { case " $1 " in *" $2 "*) return 0 ;; *) return 1 ;; esac; }

# Echo the HTTP status code, or "000" if the host is unreachable.
http_code() { # args passed straight to curl (method/url/headers)
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time "$CURL_MAX_TIME" "$@" 2>/dev/null)" || code="000"
  [ -z "$code" ] && code="000"
  printf '%s' "$code"
}

# Classify a target as OK | BLOCKED | DOWN by reading a probe body.
# BLOCKED = an egress-allowlist proxy intercepted the request (not the app).
detect_reach() { # $1 url
  local body
  body="$(curl -sS --max-time 15 "$1" 2>/dev/null)" || { printf 'DOWN'; return; }
  if printf '%s' "$body" | grep -qiE 'not in allowlist|egress settings|host not in allowlist'; then
    printf 'BLOCKED'; return
  fi
  printf 'OK'
}

# Gate a probe on its target's reachability. Returns 0 to proceed, else records
# UNVERIFIED and returns 1.
need() { # $1 reachflag $2 id
  case "$1" in
    OK)      return 0 ;;
    BLOCKED) record UNVERIFIED "$2" "egress-blocked host — run from an allowlisted runner"; return 1 ;;
    *)       record UNVERIFIED "$2" "host unreachable" ; return 1 ;;
  esac
}

echo "# daily-security-check $(date -u +%Y-%m-%dT%H:%M:%SZ)  site=$SITE  mcp=$MCP"
echo "# STATUS	id	description"

SITE_REACH="$(detect_reach "$SITE/api/health")"
MCP_REACH="$(detect_reach "$MCP/health")"
echo "# reachability  site=$SITE_REACH  mcp=$MCP_REACH"

# ---------------------------------------------------------------------------
# A. Web / edge tier
# ---------------------------------------------------------------------------

# A1 — endpoints alive (any reachable code is liveness; 403/503 acceptable)
if need "$SITE_REACH" A1; then
  for spec in "$SITE/api/health" "$SITE/.well-known/security.txt" "$SITE/"; do
    code="$(http_code "$spec")"
    if [ "$code" = "000" ]; then record UNVERIFIED A1 "unreachable: $spec"
    elif in_list "200 204 403 503" "$code"; then record PASS A1 "$spec -> $code"
    else record FAIL A1 "$spec -> $code (not a live response)"; fi
  done
fi
if need "$MCP_REACH" A1; then
  code="$(http_code "$MCP/health")"
  if [ "$code" = "000" ]; then record UNVERIFIED A1 "unreachable: $MCP/health"
  elif in_list "200 403" "$code"; then record PASS A1 "$MCP/health -> $code"
  else record FAIL A1 "$MCP/health -> $code"; fi
fi

# A2 — security headers (only meaningful when not blocked/challenged)
if need "$SITE_REACH" A2; then
  headers="$(curl -sS -D - -o /dev/null --max-time "$CURL_MAX_TIME" "$SITE/" 2>/dev/null || true)"
  present=0
  for h in "strict-transport-security" "content-security-policy" "x-frame-options" "x-content-type-options"; do
    printf '%s' "$headers" | grep -iq "^$h:" && present=$((present+1))
  done
  if [ "$present" -eq 0 ]; then
    record UNVERIFIED A2 "no security headers visible (403/bot-challenge?) — re-check from allowlisted host"
  else
    for h in "strict-transport-security" "content-security-policy" "x-frame-options" "x-content-type-options"; do
      if printf '%s' "$headers" | grep -iq "^$h:"; then record PASS A2 "header present: $h"
      else record FAIL A2 "header MISSING: $h"; fi
    done
  fi
fi

# A3 — Next.js middleware-bypass class (CVE-2025-29927): 200 on /dashboard = FAIL
if need "$SITE_REACH" A3; then
  code="$(http_code -H 'x-middleware-subrequest: middleware:middleware:middleware:middleware:middleware' "$SITE/dashboard")"
  if [ "$code" = "000" ]; then record UNVERIFIED A3 "unreachable: /dashboard"
  elif in_list "200" "$code"; then record FAIL A3 "middleware bypass: /dashboard 200 with spoofed header"
  else record PASS A3 "/dashboard not bypassable (code $code)"; fi
fi

# A4 — cron route rejects unauthenticated caller
if need "$SITE_REACH" A4; then
  code="$(http_code "$SITE/api/convene/cron/send-invites")"
  if in_list "200" "$code"; then record FAIL A4 "cron send-invites returned 200 without auth"
  elif in_list "401 403 404" "$code"; then record PASS A4 "cron rejects unauth ($code)"
  else record UNVERIFIED A4 "cron returned $code"; fi
fi

# A5 — /oauth/register rejects non-https redirect_uri (validation half of F-05).
# The rate-limit half (BUGS-38/F-05) is NOT hammer-tested against prod here.
if need "$SITE_REACH" A5; then
  code="$(http_code -X POST -H 'content-type: application/json' \
          --data '{"client_name":"dsc-probe","redirect_uris":["http://evil.example/cb"]}' \
          "$SITE/oauth/register")"
  if in_list "200 201" "$code"; then record FAIL A5 "/oauth/register accepted non-https redirect ($code)"
  elif in_list "400 422" "$code"; then record PASS A5 "/oauth/register rejects non-https redirect ($code). Rate-limit: BUGS-38/F-05"
  else record UNVERIFIED A5 "/oauth/register returned $code (blocked? re-check)"; fi
fi

# A6 — source maps not served; no service_role string in root HTML
if need "$SITE_REACH" A6; then
  code="$(http_code "$SITE/_next/static/chunks/main.js.map")"
  if in_list "200" "$code"; then record FAIL A6 "source map served ($code) — should be deleted post-upload"
  elif in_list "404 403" "$code"; then record PASS A6 "source map not served ($code)"
  else record UNVERIFIED A6 "source-map probe returned $code"; fi

  body="$(curl -sS --max-time "$CURL_MAX_TIME" "$SITE/" 2>/dev/null || true)"
  if [ -z "$body" ] || printf '%s' "$body" | grep -qiE 'not in allowlist|egress settings'; then
    record UNVERIFIED A6 "could not read root HTML for secret-string scan"
  elif printf '%s' "$body" | grep -q 'service_role'; then
    record FAIL A6 "literal 'service_role' found in root HTML — investigate immediately"
  else
    record PASS A6 "no 'service_role' string in root HTML"
  fi
fi

# A6b — /auth/callback open redirect (F-12 / BUGS-43): off-host Location = FAIL
if need "$SITE_REACH" A6b; then
  loc="$(curl -sS -o /dev/null -w '%{redirect_url}' --max-time "$CURL_MAX_TIME" \
          "$SITE/auth/callback?code=probe&next=//evil.example/x" 2>/dev/null || true)"
  if [ -z "$loc" ]; then record UNVERIFIED A6b "no redirect emitted (state-dependent) — verify manually (F-12)"
  elif [ "$(host_of "$loc")" = "evil.example" ]; then record FAIL A6b "OPEN REDIRECT: /auth/callback -> $loc (F-12/BUGS-43)"
  else record PASS A6b "/auth/callback redirect stays on-host ($loc)"; fi
fi

# A9 — open-port surface (TCP). Only 80/443 should answer on a public host.
for host in "$(host_of "$SITE")" "$(host_of "$MCP")"; do
  for port in 443 80 22 3000 5432 6543 8080; do
    if timeout 3 bash -c ">/dev/tcp/$host/$port" 2>/dev/null; then
      case "$port" in
        80|443) record PASS A9 "$host:$port open (expected)" ;;
        *)      record FAIL A9 "$host:$port OPEN — unexpected exposed port" ;;
      esac
    fi
  done
done

# ---------------------------------------------------------------------------
# C. MCP server
# ---------------------------------------------------------------------------

# C1 — unauthenticated write tool must 401
if need "$MCP_REACH" C1; then
  code="$(http_code -X POST -H 'Content-Type: application/json' \
          -H 'Accept: application/json, text/event-stream' \
          --data '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"lyra_update_profile","arguments":{"display_name":"dsc-probe"}}}' \
          "$MCP/mcp")"
  if in_list "200" "$code"; then record FAIL C1 "unauth write -> 200 (expected 401)"
  elif in_list "401" "$code"; then record PASS C1 "unauth write -> 401"
  else record UNVERIFIED C1 "unauth write -> $code (blocked? expected 401)"; fi
fi

# C2 — CORS must not reflect an arbitrary origin WITH credentials (SEC-04 / CVE-2026-54290)
if need "$MCP_REACH" C2; then
  cors="$(curl -sS -D - -o /dev/null --max-time "$CURL_MAX_TIME" -X OPTIONS \
          -H 'Origin: https://evil.example' -H 'Access-Control-Request-Method: POST' \
          "$MCP/mcp" 2>/dev/null || true)"
  if printf '%s' "$cors" | grep -iq '^access-control-allow-credentials: *true' \
     && printf '%s' "$cors" | grep -iq '^access-control-allow-origin: *https://evil.example'; then
    record FAIL C2 "CORS reflects arbitrary origin WITH credentials (SEC-04)"
  else
    record PASS C2 "CORS does not reflect evil origin with credentials"
  fi
fi

# C7 — MCP build_sha exposed (agent compares to origin/main HEAD)
if need "$MCP_REACH" C7; then
  sha="$(curl -sS --max-time "$CURL_MAX_TIME" "$MCP/.well-known/mcp.json" 2>/dev/null | grep -oE '"build_sha"[^,]*' | head -1 || true)"
  if [ -z "$sha" ]; then record UNVERIFIED C7 "could not read build_sha"
  else record PASS C7 "build_sha advertised ($sha) — compare to origin/main HEAD in agent step"; fi
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo "# ---"
echo "# summary	PASS=$PASS	FAIL=$FAIL	UNVERIFIED=$UNV"
if [ "$FAIL" -gt 0 ]; then
  echo "# RESULT: FAIL ($FAIL failing probe(s)) — investigate before clearing the daily run"
  exit 2
elif [ "$UNV" -gt 0 ]; then
  echo "# RESULT: UNVERIFIED ($UNV probe(s) could not run — likely egress/bot-block) — re-run from an allowlisted host"
  exit 1
fi
echo "# RESULT: PASS"
exit 0
