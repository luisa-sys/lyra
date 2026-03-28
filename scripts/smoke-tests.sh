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
  local ACTUAL=$(curl -so /dev/null -w "%{http_code}" --max-time 15 "$URL" 2>/dev/null || echo "000")
  if [ "$ACTUAL" = "$EXPECTED" ]; then
    echo -e "  ${GREEN}✓${NC} $LABEL: $ACTUAL"
  else
    echo -e "  ${RED}✗${NC} $LABEL: $ACTUAL (expected $EXPECTED)"
    FAILURES=$((FAILURES + 1))
  fi
}

run_production() {
  echo -e "${YELLOW}=== Production (checklyra.com) ===${NC}"
  check "https://checklyra.com" "200" "Landing page"
  check "https://checklyra.com/privacy" "200" "Privacy policy"
  check "https://checklyra.com/terms" "200" "Terms of service"
  check "https://checklyra.com/sitemap.xml" "200" "Sitemap"
  check "https://checklyra.com/robots.txt" "200" "robots.txt"
  check "https://checklyra.com/llms.txt" "200" "llms.txt"
  check "https://checklyra.com/.well-known/mcp.json" "200" "MCP discovery"
  check "https://checklyra.com/.well-known/security.txt" "200" "security.txt"
}

run_staging() {
  echo -e "${YELLOW}=== Staging (stage.checklyra.com) ===${NC}"
  # Staging is behind Vercel Auth (SSO), so 401 is expected for unauthenticated requests
  check "https://stage.checklyra.com" "401" "Staging site (behind SSO)"
}

run_dev() {
  echo -e "${YELLOW}=== Development (dev.checklyra.com) ===${NC}"
  check "https://dev.checklyra.com" "401" "Dev site (behind SSO)"
}

run_mcp() {
  echo -e "${YELLOW}=== MCP Server (mcp.checklyra.com) ===${NC}"
  check "https://mcp.checklyra.com/health" "200" "MCP health"
  # Test MCP protocol handshake
  RESPONSE=$(curl -s --max-time 15 -X POST "https://mcp.checklyra.com/mcp" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke-test","version":"1.0"}}}' 2>/dev/null || echo "")
  TOTAL=$((TOTAL + 1))
  if echo "$RESPONSE" | grep -q "lyra-mcp-server"; then
    echo -e "  ${GREEN}✓${NC} MCP initialize handshake"
  else
    echo -e "  ${RED}✗${NC} MCP initialize handshake"
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
