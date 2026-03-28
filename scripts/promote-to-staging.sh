#!/usr/bin/env bash
# Lyra — Promote develop → staging
# Usage: ./scripts/promote-to-staging.sh
#
# This script:
# 1. Verifies develop branch is clean and up to date
# 2. Merges develop into staging (fast-forward)
# 3. Pushes staging — triggers deploy-staging.yml pipeline
# 4. Waits for the pipeline to complete
# 5. Runs post-deploy health checks
# 6. Automatically rolls back if health checks fail

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

REPO="luisa-sys/lyra"
STAGING_URL="https://stage.checklyra.com"
MCP_URL="https://mcp.checklyra.com"

echo -e "${YELLOW}=== Lyra: Promote develop → staging ===${NC}"
echo ""

# 1. Verify we're on develop and it's clean
BRANCH=$(git branch --show-current)
if [ "$BRANCH" != "develop" ]; then
  echo -e "${RED}ERROR: Must be on develop branch (currently on $BRANCH)${NC}"
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo -e "${RED}ERROR: Working tree is dirty. Commit or stash changes first.${NC}"
  exit 1
fi

# 2. Fetch latest and verify develop is up to date
echo "Fetching latest from origin..."
git fetch origin
LOCAL=$(git rev-parse develop)
REMOTE=$(git rev-parse origin/develop)
if [ "$LOCAL" != "$REMOTE" ]; then
  echo -e "${RED}ERROR: Local develop is not in sync with origin. Pull first.${NC}"
  exit 1
fi

echo -e "${GREEN}✓ develop is clean and up to date${NC}"
echo ""

# 3. Record the current staging HEAD for rollback
PREV_STAGING=$(git rev-parse origin/staging 2>/dev/null || echo "none")
echo "Previous staging HEAD: $PREV_STAGING"

# 4. Merge develop into staging
echo "Merging develop into staging..."
git checkout staging
git pull origin staging
git merge develop --ff-only -m "Promote develop to staging" 2>/dev/null || git merge develop -m "Promote develop to staging"
MERGE_RESULT=$?
if [ $MERGE_RESULT -ne 0 ]; then
  echo -e "${RED}ERROR: Fast-forward merge failed. staging has diverged from develop.${NC}"
  echo "Resolve manually: git checkout staging && git merge develop"
  git checkout develop
  exit 1
fi

# 5. Push staging
echo "Pushing staging..."
git push origin staging

# 6. Switch back to develop
git checkout develop

echo -e "${GREEN}✓ staging branch updated and pushed${NC}"
echo ""

# 7. Wait for pipeline to complete
echo "Waiting for deploy-staging pipeline to complete..."
echo "(This may take 2-3 minutes)"

TIMEOUT=300
ELAPSED=0
INTERVAL=15

while [ $ELAPSED -lt $TIMEOUT ]; do
  sleep $INTERVAL
  ELAPSED=$((ELAPSED + INTERVAL))
  STATUS=$(gh run list --repo "$REPO" --branch staging --workflow deploy-staging.yml --limit 1 --json status,conclusion -q '.[0].status' 2>/dev/null || echo "unknown")

  if [ "$STATUS" = "completed" ]; then
    CONCLUSION=$(gh run list --repo "$REPO" --branch staging --workflow deploy-staging.yml --limit 1 --json conclusion -q '.[0].conclusion' 2>/dev/null)
    if [ "$CONCLUSION" = "success" ]; then
      echo -e "${GREEN}✓ Pipeline passed${NC}"
      break
    else
      echo -e "${RED}✗ Pipeline failed (conclusion: $CONCLUSION)${NC}"
      echo "Rolling back staging to previous version..."
      git checkout staging
      git reset --hard "$PREV_STAGING"
      git push origin staging --force
      git checkout develop
      echo -e "${RED}✗ Rollback complete. staging restored to $PREV_STAGING${NC}"
      exit 1
    fi
  fi
  echo "  ...pipeline still running ($ELAPSED/${TIMEOUT}s)"
done

if [ $ELAPSED -ge $TIMEOUT ]; then
  echo -e "${YELLOW}⚠ Pipeline timed out after ${TIMEOUT}s. Check manually: gh run list --repo $REPO --branch staging${NC}"
  exit 1
fi

# 8. Post-deploy health checks
echo ""
echo "Running post-deploy health checks..."

HEALTH_FAIL=0

# Check staging site (behind Vercel Auth, expect 401)
STATUS_CODE=$(curl -so /dev/null -w "%{http_code}" --max-time 10 "$STAGING_URL" 2>/dev/null || echo "000")
if [ "$STATUS_CODE" = "401" ] || [ "$STATUS_CODE" = "200" ]; then
  echo -e "  ${GREEN}✓ stage.checklyra.com: $STATUS_CODE${NC}"
else
  echo -e "  ${RED}✗ stage.checklyra.com: $STATUS_CODE (expected 200 or 401)${NC}"
  HEALTH_FAIL=1
fi

# Check MCP server (always public)
MCP_STATUS=$(curl -so /dev/null -w "%{http_code}" --max-time 10 "$MCP_URL/health" 2>/dev/null || echo "000")
if [ "$MCP_STATUS" = "200" ]; then
  echo -e "  ${GREEN}✓ mcp.checklyra.com/health: $MCP_STATUS${NC}"
else
  echo -e "  ${RED}✗ mcp.checklyra.com/health: $MCP_STATUS${NC}"
  HEALTH_FAIL=1
fi

if [ $HEALTH_FAIL -ne 0 ]; then
  echo ""
  echo -e "${RED}✗ Health checks failed. Rolling back staging...${NC}"
  git checkout staging
  git reset --hard "$PREV_STAGING"
  git push origin staging --force
  git checkout develop
  echo -e "${RED}✗ Rollback complete.${NC}"
  exit 1
fi

echo ""
echo -e "${GREEN}=== Promotion to staging complete ===${NC}"
echo "  staging is now at: $(git rev-parse origin/staging)"
echo "  Next step: ./scripts/promote-to-production.sh"
