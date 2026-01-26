#!/usr/bin/env bash
# Post-checkout logic: Rebuild build directory after switching branches
# $1 is the ref of the previous HEAD
# $2 is the ref of the new HEAD
# $3 is 1 if checking out a branch, 0 if checking out a file

# Only rebuild when switching branches, not when checking out individual files
if [ "$3" -ne 1 ]; then
    exit 0
fi

bash .github/scripts/rebuild-build.sh "post-checkout"
exit $?
