#!/usr/bin/env bash
# Build the static export and publish it to the gh-pages branch of NaukhanGreenwin/aapm-inspections.
# Served at https://naukhangreenwin.github.io/aapm-inspections/ (no CNAME).
# REMOTE env var = push URL (with token); default = this folder's git origin.
set -euo pipefail
cd "$(dirname "$0")"
REMOTE="${REMOTE:-$(git remote get-url origin)}"
[ "${SKIP_BUILD:-}" = 1 ] || npx next build
[ -f out/index.html ] || { echo "no out/ build"; exit 1; }
touch out/.nojekyll
# Commit on top of the existing gh-pages branch (no force push) so GitHub's own CNAME commits are kept.
TMP="$(mktemp -d)"
git clone -q --branch gh-pages --single-branch "$REMOTE" "$TMP" 2>/dev/null || { git -C "$TMP" init -q -b gh-pages; git -C "$TMP" remote add origin "$REMOTE"; }
# Keep the previous builds' hashed _next/static files: a phone that opened the app before this deploy
# can still lazy-load its own chunks (e.g. the PDF code at send time). Everything else is replaced.
find "$TMP" -mindepth 1 -maxdepth 1 ! -name .git ! -name CNAME ! -name _next -exec rm -rf {} +
find "$TMP/_next" -mindepth 1 -maxdepth 1 ! -name static -exec rm -rf {} + 2>/dev/null || true
cp -R out/. "$TMP/"
cd "$TMP"
git add -A
git -c user.name="Hermes" -c user.email="hermes@itrapidsupport.com" commit -q -m "Deploy $(date -u +%Y-%m-%dT%H:%MZ)" || echo "nothing to commit"
git push -q origin gh-pages
echo "Deployed to gh-pages"
