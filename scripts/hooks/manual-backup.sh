#!/bin/bash
# Manual copy script for userscripts
# Copies .user.js files to build/ directory
# Usage:
#   ./manual-backup.sh              - Copy all .user.js files
#   ./manual-backup.sh <file.user.js> - Copy specific file

BUILD_DIR="build"

# Ensure build directory exists
if [ ! -d "$BUILD_DIR" ]; then
    mkdir -p "$BUILD_DIR"
fi

TARGET_PATH="$BUILD_DIR"

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
    echo "[build] Copied: $1 -> $FILENAME"
    echo "[build] Copy complete! (1 file copied)"
    exit 0
fi

# Find all .user.js files
USER_SCRIPTS=$(find scripts -name "*.user.js" 2>/dev/null)

if [ -z "$USER_SCRIPTS" ]; then
    echo "[build] No .user.js files found in scripts directory."
    exit 0
fi

echo "[build] Copying scripts to $TARGET_PATH/"

COUNT=0
for file in $USER_SCRIPTS; do
    if [ -f "$file" ]; then
        # Extract just the filename
        FILENAME=$(basename "$file")
        
        # Copy file to build directory
        cp "$file" "$TARGET_PATH/$FILENAME"
        echo "[build] Copied: $file -> $FILENAME"
        COUNT=$((COUNT + 1))
    fi
done

echo "[build] Copy complete! ($COUNT files copied)"
