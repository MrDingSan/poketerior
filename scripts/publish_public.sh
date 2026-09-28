#!/usr/bin/env bash
# Publish the latest committed code to the public repo (MrDingSan/poketerior)
# WITHOUT the private git history. Only files committed at HEAD are copied.
#
# Usage: scripts/publish_public.sh ["commit message"]
set -euo pipefail

PRIVATE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PUBLIC_DIR="${PUBLIC_DIR:-$HOME/Documents/poketerior-public}"
PUBLIC_URL="https://github.com/MrDingSan/poketerior.git"
MESSAGE="${1:-Update from private repo ($(git -C "$PRIVATE_DIR" rev-parse --short HEAD))}"

if [ -n "$(git -C "$PRIVATE_DIR" status --porcelain --untracked-files=no)" ]; then
  echo "Note: uncommitted changes in $PRIVATE_DIR are NOT published (only HEAD is)."
fi

if [ ! -d "$PUBLIC_DIR/.git" ]; then
  git clone "$PUBLIC_URL" "$PUBLIC_DIR"
fi

# Safety: never publish into a clone whose remote is the private repo.
remote="$(git -C "$PUBLIC_DIR" remote get-url origin)"
if [ "$remote" != "$PUBLIC_URL" ]; then
  echo "Refusing: $PUBLIC_DIR points at $remote, expected $PUBLIC_URL" >&2
  exit 1
fi

cd "$PUBLIC_DIR"
git pull --ff-only -q
git rm -rq --ignore-unmatch .
git -C "$PRIVATE_DIR" archive HEAD | tar -x

# Safety: copyrighted book extracts must never reach the public repo.
if [ -e data/harrington ]; then
  echo "Refusing: data/harrington is present in the export." >&2
  exit 1
fi

git add -A
if git diff --cached --quiet; then
  echo "Public repo already matches HEAD; nothing to publish."
  exit 0
fi
git commit -q -m "$MESSAGE"
git push -q
echo "Published to $PUBLIC_URL: $(git log --oneline -1)"
