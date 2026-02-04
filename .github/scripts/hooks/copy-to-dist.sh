#!/usr/bin/env bash
# Copy to build script for userscripts
# Copies .user.js files to build/ directory
# Usage:
#   ./copy-to-dist.sh              - Copy all .user.js files
#   ./copy-to-dist.sh <file.user.js> - Copy specific file

BUILD_DIR="build"
EXTERNAL_BUILD_DIR="/mnt/d/repos/build/userscripts"

# Get the script directory and repo root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$REPO_ROOT" || exit 1

echo "[build] Working directory: $REPO_ROOT"

if [ ! -d "$BUILD_DIR" ]; then
    echo "[build] Creating build directory: $REPO_ROOT/$BUILD_DIR"
    mkdir -p "$BUILD_DIR"
fi

if [ ! -d "$EXTERNAL_BUILD_DIR" ]; then
    echo "[build] Creating external build directory: $EXTERNAL_BUILD_DIR"
    mkdir -p "$EXTERNAL_BUILD_DIR"
fi

TARGET_PATH="$BUILD_DIR"

echo "[build] Target directories: $REPO_ROOT/$TARGET_PATH and $EXTERNAL_BUILD_DIR"

# Check if a specific file was provided
if [ -n "$1" ]; then
    # Copy single file
    if [ ! -f "$1" ]; then
        echo "[build] Error: File not found: $1"
        exit 1
    fi
    
    if [[ "$1" != *.user.js ]]; then
        echo "[build] Error: File must be a .user.js file"
        exit 1
    fi
    
    FILENAME=$(basename "$1")
    cp "$1" "$TARGET_PATH/$FILENAME"
    cp "$1" "$EXTERNAL_BUILD_DIR/$FILENAME"
    echo "[build] Copied: $1 -> $FILENAME"
    echo "[build]   → Local: $TARGET_PATH/$FILENAME"
    echo "[build]   → External: $EXTERNAL_BUILD_DIR/$FILENAME"
    echo "[build] Copy complete! (1 file copied to 2 locations)"
    exit 0
fi

# Find all .user.js files in category directories at root
USER_SCRIPTS=$(find autotask chatgpt cloudradial general search -name "*.user.js" 2>/dev/null)

if [ -z "$USER_SCRIPTS" ]; then
    echo "[build] No .user.js files found in category directories."
    exit 0
fi

echo "[build] Copying scripts to $TARGET_PATH/"

COUNT=0
for file in $USER_SCRIPTS; do
    if [ -f "$file" ]; then
        # Extract just the filename
        FILENAME=$(basename "$file")
        
        # Get full paths for verification
        SOURCE="$REPO_ROOT/$file"
        DEST="$REPO_ROOT/$TARGET_PATH/$FILENAME"
        EXTERNAL_DEST="$EXTERNAL_BUILD_DIR/$FILENAME"
        
        # Get current date/time in ISO 8601 format
        MODIFIED_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
        
        # Copy file to build directory and add/update modified date
        if cp "$file" "$TARGET_PATH/$FILENAME.tmp"; then
            # Add or update the modified date comment after the version line
            awk -v date="$MODIFIED_DATE" '
/@version/ && !modified_added {
    print;
    getline;
    if ($0 ~ /@modified/) {
        print "// @modified     " date;
    } else {
        print "// @modified     " date;
        print;
    }
    modified_added=1;
    next;
}
/@modified/ { next; }
{ print; }
            ' "$TARGET_PATH/$FILENAME.tmp" > "$DEST"
            rm "$TARGET_PATH/$FILENAME.tmp"
            
            # Copy to external build directory
            cp "$DEST" "$EXTERNAL_DEST"
            
            echo "[build] ✓ Copied: $file -> $FILENAME"
            # Verify the copies
            if [ -f "$DEST" ]; then
                SIZE=$(wc -c < "$DEST" | tr -d ' ')
                echo "[build]   → Local: $DEST ($SIZE bytes, modified: $MODIFIED_DATE)"
            else
                echo "[build]   ⚠ Warning: Destination file not found: $DEST"
            fi
            if [ -f "$EXTERNAL_DEST" ]; then
                echo "[build]   → External: $EXTERNAL_DEST"
            else
                echo "[build]   ⚠ Warning: External destination file not found: $EXTERNAL_DEST"
            fi
            COUNT=$((COUNT + 1))
        else
            echo "[build] ✗ Failed to copy: $file"
        fi
    fi
done

echo "[build] Copy complete! ($COUNT files copied to both $REPO_ROOT/$TARGET_PATH and $EXTERNAL_BUILD_DIR)"
