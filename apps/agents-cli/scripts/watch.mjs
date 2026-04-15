import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const forwardedArgs = process.argv.slice(2);
const cwd = process.cwd();

const binExt = process.platform === "win32" ? ".cmd" : "";
const tscBin = path.join(cwd, "node_modules", ".bin", `tsc${binExt}`);
if (!fs.existsSync(tscBin)) {
  console.error("[watch] 找不到 tsc，请先在 agents/ 下运行: npm i");
  process.exit(1);
}

const distEntry = path.join(cwd, "dist", "cli", "index.js");

const watchPaths = [
  path.join(cwd, "dist"),
  path.join(cwd, "skills"),
  ...(process.env.AGENTS_SKILLS_DIR ? [resolveMaybeRelative(process.env.AGENTS_SKILLS_DIR)] : []),
].filter(Boolean);

const tsc = spawn(
  tscBin,
  ["-w", "-p", "tsconfig.json", "--preserveWatchOutput"],
  { stdio: "inherit", cwd }
);

await waitForFile(distEntry);

const nodeArgs = [
  "--watch",
  ...watchPaths.map((p) => `--watch-path=${p}`),
  distEntry,
  ...forwardedArgs,
];
const runner = spawn(process.execPath, nodeArgs, { stdio: "inherit", cwd });

const children = [tsc, runner];
const shutdown = (signal) => {
  for (const child of children) {
    try {
      child.kill(signal);
    } catch {
      // ignore
    }
  }
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

tsc.on("exit", (code) => {
  if (typeof code === "number" && code !== 0) {
    shutdown("SIGTERM");
    process.exit(code);
  }
});

runner.on("exit", (code) => {
  shutdown("SIGTERM");
  process.exit(typeof code === "number" ? code : 0);
});

function resolveMaybeRelative(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;
  return path.isAbsolute(trimmed) ? trimmed : path.join(cwd, trimmed);
}

async function waitForFile(filePath) {
  if (fs.existsSync(filePath)) return;
  const rel = path.relative(cwd, filePath) || filePath;
  console.log(`[watch] 等待生成 ${rel} ...`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await new Promise((r) => setTimeout(r, 200));
    if (fs.existsSync(filePath)) return;
  }
}

