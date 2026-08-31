import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const manifestPath = require.resolve("@deepseek-ai/dsh/package.json");
const manifest = require(manifestPath);

if (manifest.version !== "0.1.2-alpha.2") {
  throw new Error(
    `DeepSeek Harness version mismatch: expected 0.1.2-alpha.2, received ${String(manifest.version)}`,
  );
}

const executablePath = path.join(path.dirname(manifestPath), "lib", "bin.js");
require.resolve(executablePath);
process.stdout.write(`[deepseek-harness] verified ${manifest.version} at ${executablePath}\n`);
