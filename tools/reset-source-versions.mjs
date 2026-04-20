#!/usr/bin/env node
/**
 * Reset @version in all source userscripts to 0.0.0 and strip any
 * @modified lines.  Runs as part of the release so the committed
 * source files stay clean.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const SOURCE_DIRS = [
  "autotask",
  "chatgpt",
  "cloudradial",
  "general",
  "microsoft",
  "search",
];

let fixed = 0;

for (const dir of SOURCE_DIRS) {
  const full = join(ROOT, dir);
  if (!existsSync(full)) continue;
  for (const file of readdirSync(full)) {
    if (!file.endsWith(".user.js")) continue;
    const filePath = join(full, file);
    const original = readFileSync(filePath, "utf8");
    let code = original;

    // Reset @version to 0.0.0
    code = code.replace(/^(\/\/\s*@version)\s+.+$/m, "// @version      0.0.0");

    // Remove any @modified lines
    code = code.replace(/\n\/\/\s*@modified\s+.+/g, "");

    if (code !== original) {
      writeFileSync(filePath, code, "utf8");
      console.log(`  reset  ${dir}/${file}`);
      fixed++;
    }
  }
}

console.log(
  fixed ? `\nReset ${fixed} source file(s)` : "All source files already clean",
);
