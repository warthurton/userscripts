#!/usr/bin/env bash
# Setup script for installing git hooks
# Run this from the repository root

# Usage:
#   bash .github/scripts/setup-hooks.sh         - Always updates hooks
#   bash .github/scripts/setup-hooks.sh -r      - Reconfigure: prompts to enable/disable copy-to-dist

SCRIPTS_DIR=".github/scripts"
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

# Create pre-commit hook
cat > "$GIT_HOOKS_DIR/pre-commit" << 'EOF'
#!/usr/bin/env bash
bash .github/scripts/pre-commit.sh
exit $?
EOF
chmod +x "$GIT_HOOKS_DIR/pre-commit"
echo "✓ pre-commit hook installed"

# Create post-commit hook
cat > "$GIT_HOOKS_DIR/post-commit" << 'EOF'
#!/usr/bin/env bash
bash .github/scripts/post-commit.sh
exit $?
EOF
chmod +x "$GIT_HOOKS_DIR/post-commit"
echo "✓ post-commit hook installed"
if [ -f "$GIT_HOOKS_DIR/.disable-copy-to-dist" ]; then
    echo "Copy to dist is currently disabled (flag file present)."
else
    echo "Copy to dist is enabled by default."
fi

# Create post-merge hook
cat > "$GIT_HOOKS_DIR/post-merge" << 'EOF'
#!/usr/bin/env bash
bash .github/scripts/post-merge.sh
exit $?
EOF
chmod +x "$GIT_HOOKS_DIR/post-merge"
echo "✓ post-merge hook installed"

# Create post-checkout hook
cat > "$GIT_HOOKS_DIR/post-checkout" << 'EOF'
#!/usr/bin/env bash
bash .github/scripts/post-checkout.sh "$@"
exit $?
EOF
chmod +x "$GIT_HOOKS_DIR/post-checkout"
echo "✓ post-checkout hook installed"

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
echo "  • post-merge: Rebuilds build/ directory when pulling/merging from any branch"
echo "  • post-checkout: Rebuilds build/ directory when switching branches"
echo ""
echo "Run this script again anytime to reconfigure."
echo "Use 'bash .github/scripts/setup-hooks.sh -r' to reconfigure copy-to-dist behavior."
