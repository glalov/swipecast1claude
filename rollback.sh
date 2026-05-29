#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# CastSlate emergency rollback
# Reverts index.html and swipecast-full.jsx to the previous commit
# and immediately pushes to trigger a Vercel redeploy.
#
# Usage:
#   ./rollback.sh            — roll back one commit
#   ./rollback.sh abc1234    — roll back to a specific commit hash
#
# After running, confirm production at: https://www.castslate.com
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

TARGET="${1:-}"

echo ""
echo "═══════════════════════════════════════════"
echo "  CastSlate Emergency Rollback"
echo "═══════════════════════════════════════════"
echo ""

# Show current state
CURRENT=$(git rev-parse --short HEAD)
echo -e "  Current commit : ${RED}${CURRENT}${NC} ($(git log -1 --format='%s' HEAD))"

if [ -z "$TARGET" ]; then
  TARGET=$(git rev-parse HEAD~1)
  TSHORT=$(git rev-parse --short HEAD~1)
  echo -e "  Rolling back to: ${GREEN}${TSHORT}${NC} ($(git log -1 --format='%s' HEAD~1))"
else
  TSHORT=$(git rev-parse --short "$TARGET")
  echo -e "  Rolling back to: ${GREEN}${TSHORT}${NC} ($(git log -1 --format='%s' "$TARGET"))"
fi

echo ""
read -p "  Proceed with rollback? [y/N] " -n 1 -r CONFIRM
echo ""

if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
  echo "  Aborted."
  exit 0
fi

echo ""
echo "  Checking out files from $TSHORT..."
git checkout "$TARGET" -- index.html swipecast-full.jsx

echo "  Rebuilding index.html from rolled-back swipecast-full.jsx..."
python3 build-html.py

echo "  Staging files..."
git add index.html swipecast-full.jsx

echo "  Creating rollback commit..."
git commit -m "rollback: revert to $TSHORT after crash

Emergency rollback from $CURRENT to $TSHORT.
Run: git log --oneline to see history.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"

echo "  Pushing to production..."
git push origin main

echo ""
echo -e "${GREEN}  ✓ Rollback complete${NC}"
echo ""
echo "  Vercel will redeploy in ~15s."
echo "  Monitor: https://www.castslate.com"
echo ""
echo "  To undo this rollback (revert the revert):"
echo "    git revert HEAD && git push origin main"
echo ""
