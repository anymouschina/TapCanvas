import { execFileSync } from "node:child_process";

export type SystemSnapshot = {
  currentDate: string;
  gitBranch: string | null;
  gitStatus: string | null;
  recentCommits: string[];
};

const MAX_GIT_STATUS_CHARS = 1200;
const MAX_RECENT_COMMITS = 5;

function safeExecGit(cwd: string, args: string[]): string | null {
  try {
    const output = execFileSync("git", args, {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const trimmed = String(output || "").trim();
    return trimmed || null;
  } catch {
    return null;
  }
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  if (maxChars <= 1) return value.slice(0, maxChars);
  return `${value.slice(0, maxChars - 1).trimEnd()}…`;
}

export function buildSystemSnapshot(cwd: string): SystemSnapshot {
  const branch = safeExecGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const status = safeExecGit(cwd, ["--no-optional-locks", "status", "--short"]);
  const log = safeExecGit(cwd, ["--no-optional-locks", "log", "--oneline", "-n", String(MAX_RECENT_COMMITS)]);
  return {
    currentDate: new Date().toISOString().slice(0, 10),
    gitBranch: branch,
    gitStatus: status ? truncate(status, MAX_GIT_STATUS_CHARS) : null,
    recentCommits: log ? log.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, MAX_RECENT_COMMITS) : [],
  };
}
