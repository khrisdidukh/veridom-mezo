#!/usr/bin/env bash
# Builds the web app and publishes it to the gh-pages branch of khrisdidukh/veridom-mezo
# from a dedicated worktree. Refuses to push anywhere else.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXPECTED="khrisdidukh/veridom-mezo"
cd "$ROOT"
REMOTE_URL="$(git remote get-url origin)"
case "$REMOTE_URL" in
  *"$EXPECTED"|*"$EXPECTED.git") ;;
  *) echo "Refusing: origin is $REMOTE_URL, expected $EXPECTED" >&2; exit 1 ;;
esac
node scripts/export-abi.mjs
(cd web && npm run build)
WT="$ROOT/../veridom-mezo-pages"
git fetch origin gh-pages 2>/dev/null || true
if [ ! -d "$WT" ]; then
  if git show-ref --verify --quiet refs/remotes/origin/gh-pages; then
    git worktree add "$WT" -B gh-pages origin/gh-pages
  else
    git worktree add --detach "$WT"
    (cd "$WT" && git checkout --orphan gh-pages && git rm -rfq . || true)
  fi
fi
cd "$WT"
WT_URL="$(git remote get-url origin)"
case "$WT_URL" in *"$EXPECTED"|*"$EXPECTED.git") ;; *) echo "Refusing: worktree origin $WT_URL" >&2; exit 1 ;; esac
find . -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -r "$ROOT/web/dist/." .
touch .nojekyll
git add -A
git commit -qm "Deploy web app $(date -u +%Y-%m-%dT%H:%MZ)" || echo "nothing to commit"
git push origin gh-pages
echo "Published to https://khrisdidukh.github.io/veridom-mezo/"
