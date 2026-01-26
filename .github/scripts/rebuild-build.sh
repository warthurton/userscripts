#!/usr/bin/env bash
# Rebuild build directory: Purge and repopulate with copy-to-dist
# Usage: rebuild-build.sh [context]
# Context defaults to "rebuild" but can be "post-merge" or "post-checkout" for custom messaging

CONTEXT="${1:-rebuild}"

echo "[$CONTEXT] Detected changes to userscripts. Rebuilding build directory..."
echo ""

# Purge the build directory
if [ -d "build" ]; then
    echo "[$CONTEXT] Purging build directory..."
    rm -rf build
    echo "[$CONTEXT] ✓ Build directory purged"
fi

# Repopulate using copy-to-dist
echo "[$CONTEXT] Repopulating with copy-to-dist..."
bash .github/scripts/hooks/copy-to-dist.sh

echo ""
echo "[$CONTEXT] Build directory rebuild complete!"
exit 0
