#!/bin/bash
# Setup script for installing git hooks
# Run this from the repository root
# Usage: 
#   ./setup.sh       - Full setup with configuration
#   ./setup.sh -u    - Update hooks only (keeps existing config)

HOOKS_DIR="scripts/hooks"
GIT_HOOKS_DIR=".git/hooks"
UPDATE_ONLY=false

# Check for update-only flag
if [ "$1" = "-u" ] || [ "$1" = "--update-only" ]; then
    UPDATE_ONLY=true
fi

if [ ! -d "$GIT_HOOKS_DIR" ]; then
    echo "Error: .git/hooks directory not found. Make sure you're in the repository root."
    exit 1
fi

echo "=== Git Hooks Setup ==="
echo ""

# Copy and set permissions for pre-commit hook
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

# Copy post-commit hook
if [ -f "$HOOKS_DIR/post-commit" ]; then
    if [ -f "$GIT_HOOKS_DIR/post-commit" ]; then
        echo "Updating post-commit hook..."
    fi
    cp -f "$HOOKS_DIR/post-commit" "$GIT_HOOKS_DIR/post-commit"
    chmod +x "$GIT_HOOKS_DIR/post-commit"
    echo "✓ post-commit hook installed"
else
    echo "✗ post-commit hook not found at $HOOKS_DIR/post-commit"
fi

# If update-only mode, exit here
if [ "$UPDATE_ONLY" = true ]; then
    echo ""
    echo "✓ Hooks updated successfully!"
    exit 0
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Hooks installed:"
echo "  • pre-commit: Automatically increments PATCH version in .user.js files"
if [ "$ENABLE_BACKUP" = "y" ] || [ "$ENABLE_BACKUP" = "Y" ]; then
    echo "  • post-commit: Backs up modified .user.js files to $BACKUP_PATH"
else
    echo "  • post-commit: Backup disabled"
fi
echo ""
echo "Run this script again anytime to reconfigure."
echo "Use './setup.sh -u' to update hooks without reconfiguring."
