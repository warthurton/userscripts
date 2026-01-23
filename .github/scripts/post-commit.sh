#!/usr/bin/env bash
# Post-commit logic: Copy modified .user.js files to build/

# Check for disable flag
if [ -f ".git/hooks/.disable-copy-to-dist" ]; then
    echo "[post-commit] Copy to dist is disabled."
    exit 0
fi

# Call the copy-to-dist script with modified files
MODIFIED_FILES=$(git diff-tree --no-commit-id --name-only -r HEAD | grep '\.user\.js$')
if [ -z "$MODIFIED_FILES" ]; then
    exit 0
fi

for file in $MODIFIED_FILES; do
    bash .github/scripts/hooks/copy-to-dist.sh "$file"
done

echo "[post-commit] Copy to dist complete!"
exit 0
