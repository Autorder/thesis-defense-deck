#!/bin/bash
# Re-publish the defense deck from the working folder to GitHub Pages.
# Usage:  ~/Thesis-Defense-Deck/sync.sh  ["optional commit message"]
set -e

SRC="/Users/avihaviv/Projects/Thesis/Documentation/Thesis-Main/Presentation version 3"
DST="$HOME/Projects/Thesis/Presentation/Thesis-Defense-Deck"
MSG="${1:-Update defense deck}"

[ -d "$SRC" ] || { echo "source folder not found: $SRC"; exit 1; }

rsync -a --delete \
  --exclude '_build/' --exclude '.git/' --exclude '*.bak*' --exclude '*.tex' \
  --exclude '.DS_Store' --exclude 'SPEC.md' \
  --exclude 'sync.sh' --exclude 'robots.txt' --exclude '.nojekyll' \
  --exclude '.github/' \
  "$SRC/" "$DST/"

cd "$DST"
touch .nojekyll
printf 'User-agent: *\nDisallow: /\n' > robots.txt

# keep the deck unlisted in search engines
python3 - <<'PY'
p = 'index.html'
s = open(p, encoding='utf-8').read()
if 'name="robots"' not in s:
    s = s.replace('<head>', '<head>\n<meta name="robots" content="noindex, nofollow">', 1)
    open(p, 'w', encoding='utf-8').write(s)
PY

if git diff --quiet && git diff --cached --quiet && [ -z "$(git status --porcelain)" ]; then
  echo "No changes — site already up to date."
  exit 0
fi

git add -A
git -c user.name="Avi Haviv" -c user.email="autorderart@gmail.com" \
    commit -q -m "$MSG

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push -q origin main

echo "Pushed. Live in ~1 minute at:"
echo "  https://autorder.github.io/thesis-defense-deck/"
