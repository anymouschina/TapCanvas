import fs from "node:fs";
import path from "node:path";

export type RuntimeSessionLocationInput = {
  cwd: string;
  memoryDir: string;
};

export function resolveRuntimeSessionKey(cliSession?: unknown): string | null {
  const fromCli = typeof cliSession === "string" ? cliSession.trim() : "";
  if (fromCli) return fromCli;
  const fromTask = (process.env.AGENTS_TASK_ID || "").trim();
  return fromTask || null;
}

export function resolveRuntimeSessionStoreDir(input: RuntimeSessionLocationInput): string {
  const repoPath = (process.env.AGENTS_REPO_PATH || "").trim();
  if (repoPath) {
    const resolved = path.isAbsolute(repoPath) ? repoPath : path.resolve(input.cwd, repoPath);
    try {
      if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
        return path.join(resolved, input.memoryDir, "sessions");
      }
    } catch {
      // Ignore invalid repo path and fall back to the current workspace.
    }
  }
  return path.join(input.cwd, input.memoryDir, "sessions");
}
