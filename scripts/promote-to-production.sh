#!/usr/bin/env bash
# Lyra — Promote staging → production
# Usage: ./scripts/promote-to-production.sh
#
# This script:
# 1. Verifies staging branch is clean and up to date
# 2. Merges staging into main (fast-forward)
# 3. Pushes main — triggers deploy-production.yml pipeline
# 4. Waits for pipeline to complete
# 5. Runs post-deploy health checks and smoke tests
# 6. Automatically rolls back if any check fails
# 7. Creates a Git release tag

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

REPO="luisa-sys/lyra"
PROD_URL="https://checklyra.com"
MCP_URL="https://mcp.checklyra.com"

echo -e "${YELLOW}=== Lyra: Promote staging → PRODUCTION ===${NC}"
echo -e "${RED}⚠  This will deploy to the live production site (checklyra.com)${NC}"
echo ""
read -p "Are you sure you want to promote to production? (yes/no): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "Aborted."
  exit 0
fi

# 1. Verify we're on develop (safe starting point)
BRANCH=$(git branch --show-current)
if [ "$BRANCH" != "develop" ]; then
  echo -e "${RED}ERROR: Must be on develop branch (currently on $BRANCH)${NC}"
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo -e "${RED}ERROR: Working tree is dirty. Commit or stash changes first.${NC}"
  exit 1
fi

# 2. Fetch latest
echo "Fetching latest from origin..."
git fetch origin

# 3. Record the current production HEAD for rollback
PREV_MAIN=$(git rev-parse origin/main 2>/dev/null || echo "none")
echo "Previous production HEAD: $PREV_MAIN"

# 4. Merge staging into main
echo "Merging staging into main..."
git checkout main
git pull origin main
git merge origin/staging --ff-only -m "Promote staging to production"
if [ $? -ne 0 ]; then
  echo -e "${RED}ERROR: Fast-forward merge failed. main has diverged from staging.${NC}"
  git checkout develop
  exit 1
fi

# 5. Push main
echo "Pushing main..."
git push origin main
git checkout develop

echo -e "${GREEN}✓ main branch updated and pushed${NC}"
echo ""

# 6. Wait for pipeline to complete
echo "Waiting for deploy-production pipeline to complete..."
echo "(This may take 3-5 minutes)"

TIMEOUT=360
ELAPSED=0
INTERVAL=15

while [ $ELAPSED -lt $TIMEOUT ]; do
  sleep $INTERVAL
  ELAPSED=$((ELAPSED + INTERVAL))
  STATUS=$(gh run list --repo "$REPO" --branch main --workflow deploy-production.yml --limit 1 --json status,conclusion -q '.[0].status' 2>/dev/null || echo "unknown")

  if [ "$STATUS" = "completed" ]; then
    CONCLUSION=$(gh run list --repo "$REPO" --branch main --workflow deploy-production.yml --limit 1 --json conclusion -q '.[0].conclusion' 2>/dev/null)
    if [ "$CONCLUSION" = "success" ]; then
      echo -e "${GREEN}✓ Pipeline passed${NC}"
      break
    else
      echo -e "${RED}✗ Pipeline FAILED (conclusion: $CONCLUSION)${NC}"
      echo "Rolling back production to previous version..."
      git checkout main
      git reset --hard "$PREV_MAIN"
      git push origin main --force
      git checkout develop
      echo -e "${RED}✗ PRODUCTION ROLLBACK complete. main restored to $PREV_MAIN${NC}"
      exit 1
    fi
  fi
  echo "  ...pipeline still running ($ELAPSED/${TIMEOUT}s)"
done

if [ $ELAPSED -ge $TIMEOUT ]; then
  echo -e "${YELLOW}⚠ Pipeline timed out after ${TIMEOUT}s. Check manually.${NC}"
  exit 1
fi

# 7. Post-deploy smoke tests
echo ""
echo "Running production smoke tests..."
sleep 10  # Wait for Vercel CDN propagation

SMOKE_FAIL=0
ENDPOINTS=(
  "$PROD_URL|200|Landing page"
  "$PROD_URL/privacy|200|Privacy policy"
  "$PROD_URL/terms|200|Terms of service"
  "$PROD_URL/sitemap.xml|200|Sitemap"
  "$PROD_URL/robots.txt|200|Robots.txt"
  "$PROD_URL/llms.txt|200|LLMs.txt"
  "$PROD_URL/.well-known/mcp.json|200|MCP discovery"
  "$MCP_URL/health|200|MCP server health"
)

for ENDPOINT in "${ENDPOINTS[@]}"; do
  IFS='|' read -r URL EXPECTED_CODE LABEL <<< "$ENDPOINT"
  ACTUAL=$(curl -so /dev/null -w "%{http_code}" --max-time 10 "$URL" 2>/dev/null || echo "000")
  if [ "$ACTUAL" = "$EXPECTED_CODE" ]; then
    echo -e "  ${GREEN}✓ $LABEL: $ACTUAL${NC}"
  else
    echo -e "  ${RED}✗ $LABEL: $ACTUAL (expected $EXPECTED_CODE)${NC}"
    SMOKE_FAIL=1
  fi
done

# 8. Rollback if smoke tests failed
if [ $SMOKE_FAIL -ne 0 ]; then
  echo ""
  echo -e "${RED}✗ SMOKE TESTS FAILED. Rolling back production...${NC}"
  git checkout main
  git reset --hard "$PREV_MAIN"
  git push origin main --force
  git checkout develop
  echo -e "${RED}✗ PRODUCTION ROLLBACK complete. main restored to $PREV_MAIN${NC}"
  exit 1
fi

# 9. Create release tag
CURRENT_MAIN=$(git rev-parse origin/main)
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "v0.0.0")
# Simple version bump: increment patch
IFS='.' read -r MAJOR MINOR PATCH <<< "${LAST_TAG#v}"
NEW_TAG="v${MAJOR}.${MINOR}.$((PATCH + 1))"

echo ""
echo "Creating release tag: $NEW_TAG"
git tag -a "$NEW_TAG" origin/main -m "Release $NEW_TAG — promoted from staging"
git push origin "$NEW_TAG"

echo ""
echo -e "${GREEN}=== PRODUCTION DEPLOYMENT COMPLETE ===${NC}"
echo "  Tag:    $NEW_TAG"
echo "  Commit: $CURRENT_MAIN"
echo "  URL:    $PROD_URL"
echo "  MCP:    $MCP_URL/health"
