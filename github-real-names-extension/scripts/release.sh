#!/bin/bash

set -e

echo "=== GitHub Real Names Extension Release Script ==="
echo ""

echo "Step 1: Running checks (compile, lint, test)..."
npm run check
echo "✓ Checks passed"
echo ""

echo "Step 2: Building package..."
npm run zip
echo "✓ Package built"
echo ""

echo "Step 3: Release artifacts:"
echo ""

output_dir=".output"
if [ ! -d "$output_dir" ]; then
  echo "ERROR: $output_dir directory not found"
  exit 1
fi

cd "$output_dir"

echo "Extension packages:"
for file in *.zip; do
  if [ -f "$file" ]; then
    size=$(du -h "$file" | cut -f1)
    echo "  - $file ($size)"
  fi
done

echo ""
echo "Build artifacts available in: $output_dir"
echo "  - chrome-mv3/       Chrome/Edge extension files"
