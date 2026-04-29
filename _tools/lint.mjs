#!/usr/bin/env node

/**
 * Lint script for userscripts project
 * Usage:
 *   node _tools/lint.mjs              # Lint all source userscripts
 *   node _tools/lint.mjs <file-path>  # Lint specific file(s)
 *   node _tools/lint.mjs --fix        # Lint and fix with Prettier
 */

import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..");

// Parse CLI arguments
const args = process.argv.slice(2);
const hasFixFlag = args.includes("--fix");
const filePattern = args.find(arg => !arg.startsWith("--"));

// Determine which files to lint
let filesToLint = [];

if (filePattern) {
  // If a file pattern is provided, use it directly
  filesToLint = [filePattern];
} else {
  // Default: lint all .user.js files in script directories using glob patterns
  const scriptDirs = [
    "autotask",
    "chatgpt",
    "cloudradial",
    "general",
    "microsoft",
    "search",
    "_templates",
  ];
  filesToLint = scriptDirs.map(dir => `${dir}/**/*.user.js`);
}

console.log(`🔍 Linting with ESLint${hasFixFlag ? " (--fix)" : ""}...`);
if (filePattern) {
  console.log(`   Files: ${filePattern}`);
} else {
  console.log(
    `   Scanning: autotask/, chatgpt/, cloudradial/, general/, microsoft/, search/, _templates/`
  );
}
console.log();

// Run ESLint
const eslintArgs = [
  ...filesToLint,
  "--max-warnings=0", // Fail on any warnings
];

if (hasFixFlag) {
  eslintArgs.push("--fix");
}

const eslint = spawn("npx", ["eslint", ...eslintArgs], {
  cwd: projectRoot,
  stdio: "inherit",
});

eslint.on("close", code => {
  if (code !== 0) {
    console.error("\n❌ ESLint check failed!");
    process.exit(code);
  }

  // If --fix flag was used, run Prettier
  if (hasFixFlag) {
    console.log("\n✨ Formatting with Prettier...\n");

    const prettierArgs = [...filesToLint, "--write"];

    const prettier = spawn("npx", ["prettier", ...prettierArgs], {
      cwd: projectRoot,
      stdio: "inherit",
    });

    prettier.on("close", prettierCode => {
      if (prettierCode !== 0) {
        console.error("\n❌ Prettier formatting failed!");
        process.exit(prettierCode);
      }
      console.log("\n✅ Linting and formatting complete!");
    });
  } else {
    console.log("\n✅ Linting complete!");
  }
});

eslint.on("error", err => {
  console.error("❌ Failed to run ESLint:", err.message);
  process.exit(1);
});
