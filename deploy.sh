#!/bin/bash
# ────────────────────────────────────────────────────────────
# SwipeCast one-command deploy
#
# Usage:
#   ./deploy.sh                 → rebuilds + pushes with default commit message
#   ./deploy.sh "your message"  → rebuilds + pushes with that commit message
#
# First-time setup (run these ONCE from this folder):
#   chmod +x deploy.sh
#   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
#   git branch -M main
#   git push -u origin main
#
# After that, every deploy is: ./deploy.sh "what you changed"
# Vercel auto-rebuilds from GitHub in ~60 seconds.
# ────────────────────────────────────────────────────────────

set -e  # exit on any error
cd "$(dirname "$0")"

MSG="${1:-Update SwipeCast site}"

echo "▶ Rebuilding index.html from swipecast-full.jsx …"
python3 build-html.py

echo "▶ Staging changes …"
git add index.html swipecast-full.jsx build-html.py supabase-schema.sql deploy.sh DEPLOY-NOW.md vercel.json package.json 2>/dev/null || true

# If nothing changed, bail early.
if git diff --cached --quiet; then
  echo "✓ Nothing to commit. Files already match what's on GitHub."
  exit 0
fi

echo "▶ Committing: $MSG"
git commit -m "$MSG"

echo "▶ Pushing to GitHub …"
git push

echo ""
echo "✅ Done. Vercel will redeploy in about 60 seconds."
echo "   Live site: https://swipecast1claude.vercel.app"
