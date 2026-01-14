#!/usr/bin/env bash
# Setup script for installing git hooks
# Run this from the repository root

# Usage:
#   ./setup.sh         - Always updates hooks
#   ./setup.sh -r      - Reconfigure: prompts to enable/disable copy-to-dist

HOOKS_DIR=".github/scripts/hooks"
GIT_HOOKS_DIR=".git/hooks"
RECONFIGURE=false

# Check for reconfigure flag
if [ "$1" = "-r" ] || [ "$1" = "--reconfigure" ]; then
    RECONFIGURE=true
fi

if [ ! -d "$GIT_HOOKS_DIR" ]; then
    echo "Error: .git/hooks directory not found. Make sure you're in the repository root."
    exit 1
fi

echo "=== Git Hooks Setup ==="
echo ""

if [ -f "$HOOKS_DIR/pre-commit" ]; then
    if [ -f "$GIT_HOOKS_DIR/pre-commit" ]; then
        echo "Updating pre-commit hook..."
    fi
    cp -f "$HOOKS_DIR/pre-commit" "$GIT_HOOKS_DIR/pre-commit"
    chmod +x "$GIT_HOOKS_DIR/pre-commit"
    echo "✓ pre-commit hook installed"
else
    echo "✗ pre-commit hook not found at $HOOKS_DIR/pre-commit"
fi

if [ -f "$HOOKS_DIR/post-commit" ]; then
    if [ -f "$GIT_HOOKS_DIR/post-commit" ]; then
        echo "Updating post-commit hook..."
    fi
    cp -f "$HOOKS_DIR/post-commit" "$GIT_HOOKS_DIR/post-commit"
    chmod +x "$GIT_HOOKS_DIR/post-commit"
    echo "✓ post-commit hook installed"
    if [ -f "$GIT_HOOKS_DIR/.disable-copy-to-dist" ]; then
        echo "Copy to dist is currently disabled (flag file present)."
    else
        echo "Copy to dist is enabled by default."
    fi
else
    echo "✗ post-commit hook not found at $HOOKS_DIR/post-commit"
fi


# If reconfigure mode, prompt for copy-to-dist
if [ "$RECONFIGURE" = true ]; then
    echo ""
    echo "Do you want to copy .user.js files to build/ after each commit? [Y/n]"
    read -r ENABLE_COPY
    if [ "$ENABLE_COPY" = "n" ] || [ "$ENABLE_COPY" = "N" ]; then
        touch "$GIT_HOOKS_DIR/.disable-copy-to-dist"
        echo "Copy to build will be disabled."
    else
        rm -f "$GIT_HOOKS_DIR/.disable-copy-to-dist"
        echo "Copy to build will be enabled."
    fi
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Hooks installed:"
echo "  • pre-commit: Automatically increments PATCH version in .user.js files"
if [ -f "$GIT_HOOKS_DIR/.disable-copy-to-dist" ]; then
    echo "  • post-commit: Copy to build disabled"
else
    echo "  • post-commit: Copy to build enabled (copies modified .user.js files to build/)"
fi
echo ""
echo "Run this script again anytime to reconfigure."
echo "Use './setup.sh -r' to reconfigure copy-to-dist behavior."
