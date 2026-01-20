const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');

/**
 * Parse version from userscript header
 * Handles both 2-part (1.0) and 3-part (1.0.0) formats
 * Returns [major, minor, patch]
 */
function parseVersion(content) {
    const versionMatch = content.match(/@version\s+([\d.]+)/);
    if (!versionMatch) return null;

    const parts = versionMatch[1].split('.').map(Number);
    return [
        parts[0] || 0,      // major
        parts[1] || 0,      // minor
        parts[2] || 0       // patch (default 0 for 2-part versions)
    ];
}

/**
 * Format version as major.minor (no patch)
 * This normalizes all versions back to 2-part format for releases
 */
function formatVersion(major, minor) {
    return `${major}.${minor}`;
}

/**
 * Get file content from main branch
 */
function getMainVersion(filePath) {
    try {
        const relativePath = path.relative(process.cwd(), filePath);
        const mainContent = execFileSync('git', ['show', `main:${relativePath}`], { encoding: 'utf8' });
        return parseVersion(mainContent);
    } catch (error) {
        // File doesn't exist in main
        return null;
    }
}

/**
 * Compare versions: returns -1 if a < b, 0 if equal, 1 if a > b
 * Comparison is at major.minor level only (ignores patch)
 */
function compareVersions(versionA, versionB) {
    if (!versionA || !versionB) return null;

    // Compare major version
    if (versionA[0] !== versionB[0]) {
        return versionA[0] > versionB[0] ? 1 : -1;
    }

    // Compare minor version
    if (versionA[1] !== versionB[1]) {
        return versionA[1] > versionB[1] ? 1 : -1;
    }

    return 0; // Equal (ignoring patch version)
}

/**
 * Update version in userscript file
 */
function updateVersion(filePath, newMajor, newMinor) {
    let content = fs.readFileSync(filePath, 'utf8');
    const newVersion = formatVersion(newMajor, newMinor);

    // Replace version in header
    content = content.replace(
        /@version\s+([\d.]+)/,
        `@version      ${newVersion}`
    );

    fs.writeFileSync(filePath, content, 'utf8');
    return newVersion;
}

/**
 * Find all userscript files
 */
function findUserscripts(dir) {
    const results = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            results.push(...findUserscripts(fullPath));
        } else if (entry.isFile() && entry.name.endsWith('.user.js')) {
            results.push(fullPath);
        }
    }

    return results;
}

/**
 * Get changed files in the PR
 */
function getChangedFiles() {
    try {
        // Get list of changed files in PR
        const changedFiles = execSync('git diff --name-only origin/main...HEAD', { encoding: 'utf8' })
            .split('\n')
            .filter(f => f.endsWith('.user.js') && !f.includes('templates/'))
            .map(f => path.join(process.cwd(), f));
        return changedFiles;
    } catch (error) {
        console.error('Error getting changed files:', error.message);
        return [];
    }
}

/**
 * Main function
 */
function main() {
    console.log('🔍 Checking userscript versions...\n');

    // Get only files that changed in this PR
    const changedUserscripts = getChangedFiles();
    
    if (changedUserscripts.length === 0) {
        console.log('ℹ️  No userscript files changed in this PR');
        const fs = require('fs');
        fs.appendFileSync(process.env.GITHUB_OUTPUT, 'changes=false\n');
        return;
    }

    console.log(`📝 Found ${changedUserscripts.length} changed userscript(s):\n${changedUserscripts.map(f => '  - ' + path.relative(process.cwd(), f)).join('\n')}\n`);

    let hasChanges = false;

    for (const scriptPath of changedUserscripts) {
        const relativePath = path.relative(process.cwd(), scriptPath);
        console.log(`\n📄 Checking ${relativePath}`);

        // Get current version in PR
        const content = fs.readFileSync(scriptPath, 'utf8');
        const prVersion = parseVersion(content);

        if (!prVersion) {
            console.log('  ⚠️  No version found in PR');
            continue;
        }

        console.log(`  PR version: ${formatVersion(...prVersion)}`);

        // Get version from main branch
        const mainVersion = getMainVersion(scriptPath);

        if (!mainVersion) {
            // File doesn't exist in main - should be 1.0
            console.log('  📝 File not in main branch');

            if (prVersion[0] !== 1 || prVersion[1] !== 0) {
                console.log(`  ✏️  Setting version to 1.0`);
                updateVersion(scriptPath, 1, 0);
                hasChanges = true;
            } else {
                console.log('  ✅ Already at 1.0');
            }
            continue;
        }

        console.log(`  Main version: ${formatVersion(...mainVersion)}`);

        // Compare versions
        const comparison = compareVersions(prVersion, mainVersion);

        if (comparison === null) {
            console.log('  ⚠️  Could not compare versions');
            continue;
        }

        if (comparison > 0) {
            // PR version is ahead - check if it's already bumped by major or minor
            const majorBumped = prVersion[0] > mainVersion[0];
            const minorBumped = prVersion[0] === mainVersion[0] && prVersion[1] > mainVersion[1];

            if (majorBumped || minorBumped) {
                console.log('  ✅ Version already bumped appropriately');
                continue;
            }
        }

        // Need to bump minor version
        const newMajor = mainVersion[0];
        const newMinor = mainVersion[1] + 1;
        const newVersion = formatVersion(newMajor, newMinor);

        console.log(`  ✏️  Bumping version to ${newVersion}`);
        updateVersion(scriptPath, newMajor, newMinor);
        hasChanges = true;
    }

    // Set output for GitHub Actions using environment files (recommended)
    if (hasChanges) {
        console.log('\n✨ Version changes made!');
        const fs = require('fs');
        fs.appendFileSync(process.env.GITHUB_OUTPUT, 'changes=true\n');
    } else {
        console.log('\n✅ No version changes needed');
        const fs = require('fs');
        fs.appendFileSync(process.env.GITHUB_OUTPUT, 'changes=false\n');
    }
}

// Run the script
try {
    main();
} catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
}
