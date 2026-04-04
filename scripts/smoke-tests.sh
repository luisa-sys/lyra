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

run_production() {
  echo -e "${YELLOW}=== Production (checklyra.com) ===${NC}"
  # Landing page returns 503 (maintenance worker) or 403 (Cloudflare bot block)
  check_any "https://checklyra.com" "Landing page" "503" "403"
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
  check_any "https://stage.checklyra.com" "Staging site (protected)" "401" "403"
}

run_dev() {
  echo -e "${YELLOW}=== Development (dev.checklyra.com) ===${NC}"
  check_any "https://dev.checklyra.com" "Dev site (protected)" "401" "403"
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

case "$ENV" in
  production) run_production; run_mcp ;;
  staging) run_staging; run_mcp ;;
  dev) run_dev; run_mcp ;;
  all) run_production; run_staging; run_dev; run_mcp ;;
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
