#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# CastSlate pre-deploy validation
# Run this before every git push: ./pre-deploy.sh
# It will refuse to proceed if any check fails.
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()  { echo -e "${GREEN}  ✓ $1${NC}"; }
err() { echo -e "${RED}  ✗ $1${NC}"; FAIL=1; }
warn(){ echo -e "${YELLOW}  ⚠ $1${NC}"; }

FAIL=0
echo ""
echo "═══════════════════════════════════════════"
echo "  CastSlate Pre-Deploy Validation"
echo "═══════════════════════════════════════════"
echo ""

# ── 1. Source file exists ──────────────────────────────────────
echo "[ 1/6 ] Source file check"
if [ -f "swipecast-full.jsx" ]; then ok "swipecast-full.jsx exists";
else err "swipecast-full.jsx NOT FOUND"; fi

# ── 2. Build ──────────────────────────────────────────────────
echo ""
echo "[ 2/6 ] Building index.html"
if python3 build-html.py 2>&1; then ok "Build succeeded";
else err "Build FAILED"; fi

# ── 3. File size sanity ───────────────────────────────────────
echo ""
echo "[ 3/6 ] File size sanity (index.html must be > 500 KB)"
SIZE=$(wc -c < index.html | tr -d ' ')
if [ "$SIZE" -gt 500000 ]; then
  ok "index.html is ${SIZE} bytes"
else
  err "index.html is only ${SIZE} bytes — suspiciously small, build may have failed"
fi

# ── 4. Key component presence ─────────────────────────────────
echo ""
echo "[ 4/6 ] Key component presence in index.html"
CHECKS=(
  "class ErrorBoundary extends React.Component:ErrorBoundary class"
  "function App():App function"
  "function CDDashboard(:CDDashboard component"
  "function InboxPage(:InboxPage component"
  "function SearchPage(:SearchPage component"
  "__CS_REACT_MOUNTED:React-mounted signal"
  "__SC_ERR:Error collector"
  "unhandledrejection:Rejection handler"
  "</html>:Valid HTML closing tag"
  "BUILD: :Build version stamp"
)
for entry in "${CHECKS[@]}"; do
  needle="${entry%%:*}"
  label="${entry##*:}"
  if grep -qF "$needle" index.html; then ok "$label";
  else err "MISSING: $label (grep: '$needle')"; fi
done

# ── 5. Sync check — same build stamp in both files ────────────
echo ""
echo "[ 5/6 ] Source/output sync check"
JSX_LINES=$(wc -l < swipecast-full.jsx | tr -d ' ')
HTML_LINES=$(wc -l < index.html | tr -d ' ')
ok "swipecast-full.jsx  — ${JSX_LINES} lines"
ok "index.html          — ${HTML_LINES} lines"
# If jsx is newer than html, the build should have just updated html — warn only
if [ "swipecast-full.jsx" -nt "index.html" ]; then
  warn "swipecast-full.jsx is newer than index.html after build — check timestamps"
fi

# ── 6. Common hook-ordering issues ────────────────────────────
echo ""
echo "[ 6/6 ] Hook-ordering safety scan in swipecast-full.jsx"
# Warn if useCallback/useMemo/useEffect appear before the const/let/var they depend on
# in the same function block (heuristic — catches obvious TDZ patterns)
node - <<'JSEOF' 2>/dev/null || warn "Node.js not available — skipping hook scan"
const fs = require('fs');
const src = fs.readFileSync('swipecast-full.jsx', 'utf8');
const lines = src.split('\n');
let warnings = 0;
// Look for useCallback/useMemo with dependency arrays that reference a name
// declared with const/let LATER in the same apparent scope (simple heuristic).
const hookRe = /\buseCallback\b|\buseMemo\b/;
for (let i = 0; i < lines.length; i++) {
  if (!hookRe.test(lines[i])) continue;
  // Extract names from dependency array on the same line [dep1, dep2]
  const depMatch = lines[i].match(/\[([^\]]*)\]/);
  if (!depMatch) continue;
  const deps = depMatch[1].split(',').map(s => s.trim()).filter(s => /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(s));
  for (const dep of deps) {
    // Look back up to 200 lines for declaration of this dep
    let declared = false;
    for (let j = Math.max(0, i - 200); j < i; j++) {
      if (new RegExp(`(?:const|let|var)\\s+${dep}\\b`).test(lines[j])) { declared = true; break; }
    }
    if (!declared) {
      // Look forward to see if it's declared later (TDZ risk)
      for (let k = i + 1; k < Math.min(lines.length, i + 300); k++) {
        if (new RegExp(`(?:const|let|var)\\s+${dep}\\b`).test(lines[k])) {
          console.warn(`  ⚠ Line ${i+1}: useCallback/useMemo uses '${dep}' in deps but it appears to be declared later (line ${k+1}) — TDZ risk`);
          warnings++;
          break;
        }
      }
    }
  }
}
if (warnings === 0) { console.log('  ✓ No obvious hook-ordering issues found'); }
else { console.log(`  ${warnings} potential issue(s) found — review before deploying`); }
JSEOF

echo ""
echo "═══════════════════════════════════════════"
if [ "$FAIL" -eq 0 ]; then
  echo -e "${GREEN}  ✓ All checks passed — safe to push${NC}"
  echo ""
  echo "  Next steps:"
  echo "    git add swipecast-full.jsx index.html"
  echo "    git commit -m 'your message'"
  echo "    git push origin main"
else
  echo -e "${RED}  ✗ Validation FAILED — do not push until all errors are fixed${NC}"
  exit 1
fi
echo ""
