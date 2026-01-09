#!/bin/bash
# Manual copy script for userscripts
# Copies .user.js files to dist/ directory
# Usage:
#   ./manual-backup.sh              - Copy all .user.js files
#   ./manual-backup.sh <file.user.js> - Copy specific file

DIST_DIR="dist"

# Ensure dist directory exists
if [ ! -d "$DIST_DIR" ]; then
    mkdir -p "$DIST_DIR"
fi

TARGET_PATH="$DIST_DIR"

# Check if a specific file was provided
if [ -n "$1" ]; then
    # Copy single file
    if [ ! -f "$1" ]; then
        echo "[dist] Error: File not found: $1"
        exit 1
    fi
    
    if [[ "$1" != *.user.js ]]; then
        echo "[dist] Error: File must be a .user.js file"
        exit 1
    fi
    
    FILENAME=$(basename "$1")
    cp "$1" "$TARGET_PATH/$FILENAME"
    echo "[dist] Copied: $1 -> $FILENAME"
    echo "[dist] Copy complete! (1 file copied)"
    exit 0
fi

# Find all .user.js files
USER_SCRIPTS=$(find scripts -name "*.user.js" 2>/dev/null)

if [ -z "$USER_SCRIPTS" ]; then
    echo "[dist] No .user.js files found in scripts directory."
    exit 0
fi

echo "[dist] Copying scripts to $TARGET_PATH/"

COUNT=0
for file in $USER_SCRIPTS; do
    if [ -f "$file" ]; then
        # Extract just the filename
        FILENAME=$(basename "$file")
        
        # Copy file to dist directory
        cp "$file" "$TARGET_PATH/$FILENAME"
        echo "[dist] Copied: $file -> $FILENAME"
        COUNT=$((COUNT + 1))
    fi
done

echo "[dist] Copy complete! ($COUNT files copied)"
