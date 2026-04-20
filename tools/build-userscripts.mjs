#!/usr/bin/env node
/**
 * Build script for userscripts.
 *
 * Each script gets its own date-based version (YYYY.MMDD.HHMM) that is
 * decoupled from the repo/package.json version.  A script's version is
 * only bumped when its content actually changes compared to the previous
 * _dist/ output.  Unchanged scripts keep their existing _dist/ version
 * so that userscript managers don't re-download identical code.
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

const forceAllScripts =
  process.env.FORCE_ALL_SCRIPTS === "1" ||
  process.env.FORCE_ALL_SCRIPTS === "true";

// ── Helpers ─────────────────────────────────────────────────────────

/** Generate a date-based version: YYYY.MMDD.HHMM */
const makeDateVersion = (date = new Date()) => {
  const y = date.getUTCFullYear();
  const mo = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const h = String(date.getUTCHours()).padStart(2, "0");
  const mi = String(date.getUTCMinutes()).padStart(2, "0");
  return `${y}.${mo}${d}.${h}${mi}`;
};

/** Strip volatile metadata lines so we can compare "real" content. */
const stripMeta = (code) =>
  code
    .replace(/^\/\/\s*@version\s+.+\n?/m, "")
    .replace(/^\/\/\s*@modified\s+.+\n?/m, "")
    .replace(/^\/\/\s*@updateURL\s+.+\n?/m, "")
    .replace(/^\/\/\s*@downloadURL\s+.+\n?/m, "");

/** Read existing @version from a _dist file, or null. */
const readExistingVersion = (distPath) => {
  if (!existsSync(distPath)) return null;
  const m = readFileSync(distPath, "utf8").match(/@version\s+([\d.]+)/);
  return m ? m[1] : null;
};

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

const now = new Date();
const dateVersion = makeDateVersion(now);
const isoNow = now.toISOString();
let changed = 0;
let unchanged = 0;

for (const s of scripts) {
  let code = readFileSync(s.src, "utf8");
  const baseName = s.file.replace(/\.user\.js$/, "");
  const distUserPath = join(DIST, s.file);
  const distMetaPath = join(DIST, `${baseName}.meta.js`);

  const metaUrl = `${RAW_BASE}/_dist/${baseName}.meta.js`;
  const dlUrl = `${RAW_BASE}/_dist/${s.file}`;

  // Rewrite URLs first (before content comparison)
  code = code.replace(
    /(\/\/\s*@updateURL)\s+.+/,
    `// @updateURL    ${metaUrl}`,
  );
  code = code.replace(
    /(\/\/\s*@downloadURL)\s+.+/,
    `// @downloadURL  ${dlUrl}`,
  );

  // Compare content (ignoring volatile metadata) with existing dist
  const existingDist = existsSync(distUserPath)
    ? readFileSync(distUserPath, "utf8")
    : null;
  const contentChanged =
    forceAllScripts ||
    !existingDist ||
    stripMeta(code) !== stripMeta(existingDist);

  if (contentChanged) {
    // Stamp new date-based version
    code = code.replace(
      /(\/\/\s*@version)\s+.+/,
      `// @version      ${dateVersion}`,
    );

    // Remove any existing @modified line, then insert after @version
    code = code.replace(/\n\/\/\s*@modified\s+.+/g, "");
    code = code.replace(
      /(\/\/\s*@version\s+.+)/,
      `$1\n// @modified     ${isoNow}`,
    );

    writeFileSync(distUserPath, code, "utf8");

    const metaBlock = code.match(
      /(\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==)/,
    );
    if (metaBlock) {
      writeFileSync(distMetaPath, metaBlock[1] + "\n", "utf8");
    }

    const oldVer = readExistingVersion(distUserPath);
    console.log(
      `  CHANGED  ${s.dir}/${s.file} → ${dateVersion}${oldVer && oldVer !== dateVersion ? ` (was ${oldVer})` : ""}`,
    );
    changed++;
  } else {
    console.log(
      `  unchanged  ${s.dir}/${s.file} (${readExistingVersion(distUserPath)})`,
    );
    unchanged++;
  }
}

console.log(
  `\nDone: ${changed} changed, ${unchanged} unchanged (version format: ${dateVersion})`,
);

if (forceAllScripts) {
  console.log("Force mode enabled via FORCE_ALL_SCRIPTS");
}
