#!/usr/bin/env bash
# Lyra — Smoke Tests
# Runs health checks against all Lyra endpoints
# Usage: ./scripts/smoke-tests.sh [environment]
#   environment: dev (default), staging, production, all

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ENV="${1:-production}"
FAILURES=0
TOTAL=0

check() {
  local URL="$1"
  local EXPECTED="$2"
  local LABEL="$3"
  TOTAL=$((TOTAL + 1))
  # Use a browser-like User-Agent to avoid Cloudflare bot blocking on CI runners
  local ACTUAL=$(curl -so /dev/null -w "%{http_code}" --max-time 15 \
    -A "Mozilla/5.0 (compatible; LyraSmokeTest/1.0; +https://checklyra.com)" \
    "$URL" 2>/dev/null || echo "000")
  if [ "$ACTUAL" = "$EXPECTED" ]; then
    echo -e "  ${GREEN}✓${NC} $LABEL: $ACTUAL"
  else
    echo -e "  ${RED}✗${NC} $LABEL: $ACTUAL (expected $EXPECTED)"
    FAILURES=$((FAILURES + 1))
  fi
}

# Accept multiple valid status codes for endpoints behind Cloudflare
check_any() {
  local URL="$1"
  local LABEL="$2"
  shift 2
  local EXPECTED_CODES=("$@")
  TOTAL=$((TOTAL + 1))
  local ACTUAL=$(curl -so /dev/null -w "%{http_code}" --max-time 15 \
    -A "Mozilla/5.0 (compatible; LyraSmokeTest/1.0; +https://checklyra.com)" \
    "$URL" 2>/dev/null || echo "000")
  local MATCHED=0
  for code in "${EXPECTED_CODES[@]}"; do
    if [ "$ACTUAL" = "$code" ]; then
      MATCHED=1
      break
    fi
  done
  if [ "$MATCHED" = "1" ]; then
    echo -e "  ${GREEN}✓${NC} $LABEL: $ACTUAL"
  else
    echo -e "  ${RED}✗${NC} $LABEL: $ACTUAL (expected one of: ${EXPECTED_CODES[*]})"
    FAILURES=$((FAILURES + 1))
  fi
}

# BUGS-134 — an environment that must sit behind Cloudflare Access.
# Access answers an unauthenticated browser-shaped request with a 302 to its
# login page, not a bare 401/403, so a gated site used to false-FAIL here.
# A redirect counts as gated ONLY when it points at Lyra's own Access team
# login for THIS host: a 302 anywhere else (a misrouted domain, an app-level
# redirect, a different Access team) is still a failure, and a bare 200 is
# still the "site is public" failure (SEC-192).
ACCESS_TEAM_DOMAIN="checklyra.cloudflareaccess.com"
check_access_gated() {
  local URL="$1"
  local LABEL="$2"
  local HOST="${URL#https://}"
  HOST="${HOST%%/*}"
  TOTAL=$((TOTAL + 1))
  local RESULT
  RESULT=$(curl -so /dev/null -w "%{http_code} %{redirect_url}" --max-time 15 \
    -A "Mozilla/5.0 (compatible; LyraSmokeTest/1.0; +https://checklyra.com)" \
    "$URL" 2>/dev/null || echo "000")
  local CODE="${RESULT%% *}"
  local LOCATION=""
  [ "$RESULT" != "$CODE" ] && LOCATION="${RESULT#* }"
  local LOGIN_PREFIX="https://${ACCESS_TEAM_DOMAIN}/cdn-cgi/access/login/${HOST}"
  case "$CODE" in
    401|403)
      echo -e "  ${GREEN}✓${NC} $LABEL: $CODE"
      return
      ;;
    302|303)
      case "$LOCATION" in
        "$LOGIN_PREFIX"|"$LOGIN_PREFIX"\?*|"$LOGIN_PREFIX"/*)
          echo -e "  ${GREEN}✓${NC} $LABEL: $CODE → Cloudflare Access login"
          return
          ;;
      esac
      echo -e "  ${RED}✗${NC} $LABEL: $CODE to ${LOCATION:-<no location>} (expected 401/403, or a redirect to $LOGIN_PREFIX)"
      ;;
    *)
      echo -e "  ${RED}✗${NC} $LABEL: $CODE (expected 401/403, or a redirect to $LOGIN_PREFIX)"
      ;;
  esac
  FAILURES=$((FAILURES + 1))
}

run_production() {
  echo -e "${YELLOW}=== Production (checklyra.com) ===${NC}"
  # Landing page: 200 (live site — the normal state since launch), 503
  # (maintenance worker), or 403 (Cloudflare bot-blocking the CI runner).
  # BUGS-134: 200 was missing, so the one time the runner reached the healthy
  # live site it reported FAIL.
  check_any "https://checklyra.com" "Landing page" "200" "503" "403"
  check_any "https://checklyra.com/privacy" "Privacy policy" "200" "403"
  check_any "https://checklyra.com/terms" "Terms of service" "200" "403"
  check_any "https://checklyra.com/cookies" "Cookie policy" "200" "403"
  check_any "https://checklyra.com/sitemap.xml" "Sitemap" "200" "403"
  check_any "https://checklyra.com/robots.txt" "robots.txt" "200" "403"
  check_any "https://checklyra.com/llms.txt" "llms.txt" "200" "403"
  check_any "https://checklyra.com/.well-known/mcp.json" "MCP discovery" "200" "403"
  check_any "https://checklyra.com/.well-known/security.txt" "security.txt" "200" "403"
}

run_staging() {
  echo -e "${YELLOW}=== Staging (stage.checklyra.com) ===${NC}"
  check_access_gated "https://stage.checklyra.com" "Staging site (protected)"
  check_e2e_alias_gated "https://e2e-stage.checklyra.com" "Staging E2E alias (gated, SEC-201)"
}

run_dev() {
  echo -e "${YELLOW}=== Development (dev.checklyra.com) ===${NC}"
  check_access_gated "https://dev.checklyra.com" "Dev site (protected)"
  check_e2e_alias_gated "https://e2e-dev.checklyra.com" "Dev E2E alias (gated, SEC-201)"
}

# SEC-201 — the grey-cloud E2E aliases skip Cloudflare entirely (DNS-only, so
# CI avoids Bot Fight Mode), which means Cloudflare Access cannot gate them.
# The app's e2e-host gate answers 404 unless the harness secret header is
# present. This runner sends no secret, so 404 is the only healthy answer; a
# 200 means the develop/staging app is public on the alias again.
check_e2e_alias_gated() {
  check_any "$1" "$2" "404"
}

run_mcp() {
  echo -e "${YELLOW}=== MCP Server (mcp.checklyra.com) ===${NC}"
  check_any "https://mcp.checklyra.com/health" "MCP health" "200" "403"
  # Test MCP protocol handshake
  MCP_HTTP_CODE=$(curl -so /dev/null -w "%{http_code}" --max-time 15 -X POST "https://mcp.checklyra.com/mcp" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -A "Mozilla/5.0 (compatible; LyraSmokeTest/1.0; +https://checklyra.com)" \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke-test","version":"1.0"}}}' 2>/dev/null || echo "000")
  RESPONSE=$(curl -s --max-time 15 -X POST "https://mcp.checklyra.com/mcp" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -A "Mozilla/5.0 (compatible; LyraSmokeTest/1.0; +https://checklyra.com)" \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke-test","version":"1.0"}}}' 2>/dev/null || echo "")
  TOTAL=$((TOTAL + 1))
  if echo "$RESPONSE" | grep -q "lyra-mcp-server"; then
    echo -e "  ${GREEN}✓${NC} MCP initialize handshake"
  elif [ "$MCP_HTTP_CODE" = "403" ]; then
    echo -e "  ${GREEN}✓${NC} MCP handshake (Cloudflare protected — 403)"
  else
    echo -e "  ${RED}✗${NC} MCP initialize handshake (HTTP $MCP_HTTP_CODE)"
    FAILURES=$((FAILURES + 1))
  fi
}

# KAN-323 — Admin MCP (admin-mcp.checklyra.com). A SEPARATE, owner-gated deploy
# behind Cloudflare Access, so the check is deliberately shaped for that:
#   * OFF by default; only runs once ADMIN_MCP_HEALTHCHECK_ENABLED=1 is set (an
#     Actions variable flipped at go-live). The admin MCP is intentionally not
#     live until its SEC sign-off — a hard check before then would alert on a
#     service that doesn't exist yet, not a real fault. A loud NOTICE is printed
#     while it's off (never a silent green).
#     # integrity-ok: deliberate opt-in for a not-yet-live, owner-gated service (KAN-323)
#   * From a CI runner (no CF Access token) a HEALTHY admin MCP returns 403
#     (Access challenge). A bare 200 means Access is NOT protecting the admin
#     surface — a security failure. 000/4xx/5xx means it is down.
#   * If CF Access service-token secrets are present, additionally verify true
#     origin health through Access (/health -> {"status":"ok"}).
run_admin_mcp() {
  echo -e "${YELLOW}=== Admin MCP (admin-mcp.checklyra.com) ===${NC}"
  local HOST="https://admin-mcp.checklyra.com"

  if [ "${ADMIN_MCP_HEALTHCHECK_ENABLED:-}" != "1" ]; then
    echo -e "  ${YELLOW}⚠ NOTICE${NC} Admin MCP health check is OFF — set ADMIN_MCP_HEALTHCHECK_ENABLED=1 once KAN-323 is deployed + SEC-signed-off. (Not yet live; nothing checked, not counted as pass.)"
    return
  fi

  # Deep check through Cloudflare Access when a service token is configured.
  if [ -n "${CF_ACCESS_CLIENT_ID:-}" ] && [ -n "${CF_ACCESS_CLIENT_SECRET:-}" ]; then
    TOTAL=$((TOTAL + 1))
    local BODY
    BODY=$(curl -s --max-time 15 \
      -H "CF-Access-Client-Id: ${CF_ACCESS_CLIENT_ID}" \
      -H "CF-Access-Client-Secret: ${CF_ACCESS_CLIENT_SECRET}" \
      "$HOST/health" 2>/dev/null || echo "")
    if echo "$BODY" | grep -q '"status":"ok"'; then
      echo -e "  ${GREEN}✓${NC} Admin MCP origin health (authenticated /health -> status:ok)"
    else
      echo -e "  ${RED}✗${NC} Admin MCP origin /health did not return status:ok through CF Access"
      FAILURES=$((FAILURES + 1))
    fi
    return
  fi

  # Unauthenticated: assert reachable AND that Cloudflare Access is gating it.
  TOTAL=$((TOTAL + 1))
  local CODE
  CODE=$(curl -so /dev/null -w "%{http_code}" --max-time 15 \
    -A "Mozilla/5.0 (compatible; LyraSmokeTest/1.0; +https://checklyra.com)" \
    "$HOST/health" 2>/dev/null || echo "000")
  case "$CODE" in
    401|403|302)
      # CF Access challenges an unauthenticated request with 401 (API/CLI clients),
      # 403, or a 302 redirect to the team login page — all mean "reachable + Access
      # is gating it", which is the healthy state from a CI runner without a token.
      echo -e "  ${GREEN}✓${NC} Admin MCP reachable + Cloudflare Access gating it ($CODE)"
      ;;
    200)
      # 200 unauthenticated should never happen once CF Access is on. Distinguish
      # "admin surface exposed" from "this domain points at the wrong service".
      local WHO
      WHO=$(curl -s --max-time 15 -A "Mozilla/5.0 (compatible; LyraSmokeTest/1.0; +https://checklyra.com)" "$HOST/health" 2>/dev/null || echo "")
      if echo "$WHO" | grep -q 'lyra-admin-mcp-server'; then
        echo -e "  ${RED}✗${NC} Admin MCP /health is PUBLIC (200) — Cloudflare Access is NOT protecting the admin surface!"
      else
        echo -e "  ${RED}✗${NC} admin-mcp.checklyra.com returns 200 but is NOT the admin server — domain points at the wrong service (got: $(echo "$WHO" | head -c 80))"
      fi
      FAILURES=$((FAILURES + 1))
      ;;
    *)
      echo -e "  ${RED}✗${NC} Admin MCP unreachable/unhealthy (HTTP $CODE)"
      FAILURES=$((FAILURES + 1))
      ;;
  esac
}

case "$ENV" in
  production) run_production; run_mcp; run_admin_mcp ;;
  staging) run_staging; run_mcp ;;
  dev) run_dev; run_mcp ;;
  all) run_production; run_staging; run_dev; run_mcp; run_admin_mcp ;;
  *) echo "Usage: $0 [dev|staging|production|all]"; exit 1 ;;
esac

echo ""
echo "=== Results: $((TOTAL - FAILURES))/$TOTAL passed ==="
if [ $FAILURES -gt 0 ]; then
  echo -e "${RED}$FAILURES check(s) failed${NC}"
  exit 1
else
  echo -e "${GREEN}All checks passed${NC}"
fi
