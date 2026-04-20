#!/usr/bin/env node
/**
 * Build script for userscripts.
 *
 * Reads every *.user.js from the source category directories, stamps
 * them with the current version from package.json, rewrites the
 * @updateURL / @downloadURL to point at _dist/, and writes both the
 * full .user.js and a metadata-only .meta.js into _dist/.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DIST = join(ROOT, "_dist");

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const VERSION = pkg.version;

const OWNER = "warthurton";
const REPO = "userscripts";
const BRANCH = "main";
const RAW_BASE = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}`;

const SOURCE_DIRS = [
  "autotask",
  "chatgpt",
  "cloudradial",
  "general",
  "microsoft",
  "search",
];

// ── Collect source scripts ──────────────────────────────────────────
const scripts = [];
for (const dir of SOURCE_DIRS) {
  const full = join(ROOT, dir);
  if (!existsSync(full)) continue;
  for (const file of readdirSync(full)) {
    if (file.endsWith(".user.js")) {
      scripts.push({ dir, file, src: join(full, file) });
    }
  }
}

if (scripts.length === 0) {
  console.log("No source scripts found.");
  process.exit(0);
}

// ── Build _dist/ ────────────────────────────────────────────────────
mkdirSync(DIST, { recursive: true });

const now = new Date().toISOString();
let built = 0;

for (const s of scripts) {
  let code = readFileSync(s.src, "utf8");
  const baseName = s.file.replace(/\.user\.js$/, "");

  const metaUrl = `${RAW_BASE}/_dist/${baseName}.meta.js`;
  const dlUrl = `${RAW_BASE}/_dist/${s.file}`;

  // Stamp @version (preserve leading "// @version" text, re-pad)
  code = code.replace(/(\/\/\s*@version)\s+.+/, `// @version      ${VERSION}`);

  // Remove any existing @modified line, then insert one after @version
  code = code.replace(/\n\/\/\s*@modified\s+.+/g, "");
  code = code.replace(/(\/\/\s*@version\s+.+)/, `$1\n// @modified     ${now}`);

  // Rewrite @updateURL → _dist meta.js
  code = code.replace(
    /(\/\/\s*@updateURL)\s+.+/,
    `// @updateURL    ${metaUrl}`,
  );

  // Rewrite @downloadURL → _dist user.js
  code = code.replace(
    /(\/\/\s*@downloadURL)\s+.+/,
    `// @downloadURL  ${dlUrl}`,
  );

  // Write full .user.js
  writeFileSync(join(DIST, s.file), code, "utf8");

  // Extract metadata block and write .meta.js
  const metaBlock = code.match(
    /(\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==)/,
  );
  if (metaBlock) {
    writeFileSync(
      join(DIST, `${baseName}.meta.js`),
      metaBlock[1] + "\n",
      "utf8",
    );
  }

  console.log(
    `  ${s.dir}/${s.file} → _dist/${s.file} + _dist/${baseName}.meta.js`,
  );
  built++;
}

console.log(`\nBuilt ${built} scripts with version ${VERSION}`);
