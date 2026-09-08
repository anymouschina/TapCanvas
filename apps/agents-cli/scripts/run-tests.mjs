import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(scriptDir, "..", "dist");
const skillsDir = path.resolve(scriptDir, "..", "skills");

function collectTests(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTests(fullPath));
      continue;
    }
    if (entry.isFile() && (entry.name.endsWith(".test.js") || entry.name.endsWith(".test.mjs"))) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

const testFiles = [...collectTests(distDir), ...collectTests(skillsDir)].sort();
if (testFiles.length === 0) {
  console.error("[agents-cli] no test files found under dist/ or skills/");
  process.exit(1);
}

let failed = false;

for (const testFile of testFiles) {
  const result = spawnSync(process.execPath, ["--test", testFile], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
