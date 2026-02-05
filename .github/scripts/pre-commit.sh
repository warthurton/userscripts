#!/usr/bin/env bash
# Pre-commit logic: Automatic PATCH version bumping
# Increments the PATCH version in all modified .user.js files

# Get list of modified .user.js files
MODIFIED_FILES=$(git diff --cached --name-only --diff-filter=ACM | grep '\.user\.js$')

if [ -z "$MODIFIED_FILES" ]; then
    exit 0
fi

echo "[pre-commit] Updating PATCH versions..."

for file in $MODIFIED_FILES; do
    # Skip files in excluded directories (templates, build, .github, etc.)
    if [[ "$file" == templates/* ]] || [[ "$file" == build/* ]] || [[ "$file" == .github/* ]]; then
        continue
    fi
    
    if [ -f "$file" ]; then
        # Extract current version (use simpler method with tr and cut)
        CURRENT_VERSION=$(grep -m 1 '@version' "$file" | tr -s ' ' | cut -d' ' -f3)
        
        # Check if version matches X.Y or X.Y.Z format
        if [ -n "$CURRENT_VERSION" ] && [[ "$CURRENT_VERSION" =~ ^[0-9]+\.[0-9]+(\.[0-9]+)?$ ]]; then
            # Parse version components
            MAJOR=$(echo "$CURRENT_VERSION" | cut -d. -f1)
            MINOR=$(echo "$CURRENT_VERSION" | cut -d. -f2)
            PATCH=$(echo "$CURRENT_VERSION" | cut -d. -f3)
            
            # If no PATCH version (for X.Y format), default to 0
            if [ -z "$PATCH" ] || [ "$PATCH" = "$CURRENT_VERSION" ]; then
                PATCH=0
            fi
            
            # Increment PATCH
            NEW_PATCH=$((PATCH + 1))
            NEW_VERSION="$MAJOR.$MINOR.$NEW_PATCH"
            
            # Update version in file (replace first occurrence only)
            sed -i "0,/@version.*$CURRENT_VERSION/s/@version.*$CURRENT_VERSION/@version      $NEW_VERSION/" "$file"
            
            # Remove any @modified lines to reduce deltas during development
            # (copy-to-dist and GitHub actions will add it back)
            sed -i '/@modified/d' "$file"
            
            # Stage the updated file
            git add "$file"
            
            echo "[pre-commit] Updated $file: $CURRENT_VERSION -> $NEW_VERSION"
        else
            echo "[pre-commit] Warning: Could not find version in $file"
        fi
    fi
done

exit 0
