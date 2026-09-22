#!/bin/bash
#
# Cuts a release of the browser extension — and only of the extension.
#
# The extension shares a repository with the Fabric Pass server, so a release here
# must not look like a release of the whole repo: the tag carries the prefix
# `extension-v`, which is what `.github/workflows/extension-release.yml` triggers on,
# and nothing outside this directory is touched. The server's own tags are left alone.
#
# Usage:
#   ./scripts/release.sh                 release the version already in package.json
#   ./scripts/release.sh patch           bump the patch version first (0.3.0 -> 0.3.1)
#   ./scripts/release.sh minor|major     same, for the other two parts
#   ./scripts/release.sh 1.2.3           set that exact version
#   ./scripts/release.sh patch --push    also push the commit and the tag
#
# Without --push nothing leaves the machine: the script stops after the tag and prints
# the two commands that publish it, so a tag can still be deleted if the artifacts look
# wrong.

set -e

cd "$(dirname "$0")/.."

bump=""
push="no"
for arg in "$@"; do
  case "$arg" in
    --push) push="yes" ;;
    *) bump="$arg" ;;
  esac
done

echo "=== GitHub Real Names Extension release ==="
echo ""

# A release describes a commit, so anything uncommitted here would ship under a version
# that doesn't match what is in git. Only this directory is checked — work in progress
# elsewhere in the repository is none of the extension's business.
if [ -n "$(git status --porcelain -- .)" ]; then
  echo "ERROR: uncommitted changes in $(pwd)."
  echo "Commit or stash them first — a release must describe a commit."
  git status --short -- .
  exit 1
fi

if [ -n "$bump" ]; then
  echo "Step 1: bumping the version ($bump)..."
  npm version "$bump" --no-git-tag-version > /dev/null
  echo "✓ package.json now says $(node -p "require('./package.json').version")"
else
  echo "Step 1: keeping the version already in package.json"
fi
echo ""

version="$(node -p "require('./package.json').version")"
tag="extension-v$version"

if git rev-parse "$tag" > /dev/null 2>&1; then
  echo "ERROR: tag $tag already exists."
  echo "Bump the version first: ./scripts/release.sh patch"
  exit 1
fi

echo "Step 2: running checks (compile, lint, test)..."
npm run check
echo "✓ Checks passed"
echo ""

echo "Step 3: building the zip archive..."
npm run zip
echo "✓ Package built"
echo ""

echo "Artifacts in .output:"
for file in .output/*.zip; do
  [ -f "$file" ] && echo "  - $file ($(du -h "$file" | cut -f1))"
done
echo ""

if [ -n "$bump" ]; then
  echo "Step 4: committing the version bump..."
  git add package.json
  git commit -q -m "chore(extension): release $tag"
  echo "✓ Committed"
  echo ""
fi

echo "Step 5: tagging $tag..."
git tag -a "$tag" -m "GitHub Real Names Extension $version"
echo "✓ Tagged"
echo ""

branch="$(git rev-parse --abbrev-ref HEAD)"

if [ "$push" = "yes" ]; then
  echo "Step 6: pushing..."
  git push origin "$branch"
  git push origin "$tag"
  echo ""
  echo "Done. The 'Release extension' workflow now builds the archive and publishes"
  echo "https://github.com/constructorfabric/fabric-pass/releases/tag/$tag"
else
  echo "Nothing has been pushed. To publish this release:"
  echo ""
  echo "  git push origin $branch"
  echo "  git push origin $tag"
  echo ""
  echo "To undo instead:  git tag -d $tag"
fi
