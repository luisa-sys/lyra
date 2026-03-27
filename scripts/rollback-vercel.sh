#!/usr/bin/env bash
# Lyra - Vercel Deployment Rollback Script
# Usage: ./scripts/rollback-vercel.sh [environment]
# Environment: production (default) | preview
#
# This script lists recent deployments and lets you promote
# a previous deployment to the specified environment.

set -euo pipefail

ENV="${1:-production}"
PROJECT="lyra"

echo "=== Lyra Vercel Rollback ==="
echo "Environment: $ENV"
echo ""

# List recent deployments
echo "Recent deployments:"
vercel ls 2>&1 | head -15
echo ""

if [ "$ENV" = "production" ]; then
  echo "To rollback production, run:"
  echo "  vercel promote <DEPLOYMENT_URL> --yes"
  echo ""
  echo "Example:"
  echo "  vercel promote https://lyra-abc123-luisa-sys-projects.vercel.app --yes"
  echo ""
  echo "Or use the Vercel dashboard:"
  echo "  https://vercel.com/luisa-sys-projects/lyra/deployments"
  echo "  → Click the three dots on a previous deployment → Promote to Production"
else
  echo "Preview deployments are automatically assigned by branch."
  echo "To rollback, revert the Git commit and push:"
  echo "  git revert HEAD && git push"
fi
