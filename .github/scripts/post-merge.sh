#!/usr/bin/env bash
# Post-merge logic: Rebuild build directory after merging/pulling from any branch

# Only rebuild if source files changed
CHANGED_FILES=$(git diff HEAD@{1} HEAD --name-only | grep '\.user\.js$')

if [ -z "$CHANGED_FILES" ]; then
    exit 0
fi

bash .github/scripts/rebuild-build.sh "post-merge"
exit $?
