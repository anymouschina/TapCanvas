import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getAgentsHomeDir } from "../core/config.js";

export function resolveSkillsDirs(cwd: string, workspaceRoot: string, configuredSkillsDir: string): string[] {
  const configuredRaw = String(configuredSkillsDir || "skills").trim() || "skills";
  const configuredIsAbs = path.isAbsolute(configuredRaw);
  const configuredFromCwd = path.resolve(cwd, configuredRaw);
  const configuredAbs = configuredIsAbs ? path.resolve(configuredRaw) : configuredFromCwd;
  const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const bundledSkillsDir = path.join(moduleRoot, "skills");
  const globalSkillsDir = path.join(getAgentsHomeDir(), "skills");
  const discoveredWorkspaceDirs = findWorkspaceSkillsDirs(workspaceRoot);
  const candidates = [
    configuredAbs,
    configuredFromCwd,
    path.join(cwd, "skills"),
    ...discoveredWorkspaceDirs,
    bundledSkillsDir,
    globalSkillsDir,
  ];

  const uniqueCandidates = Array.from(new Set(candidates.map((candidate) => path.resolve(candidate))));
  const validCandidates = uniqueCandidates.filter((candidate) => hasSkillFiles(candidate));
  return validCandidates.length > 0 ? validCandidates : [configuredAbs];
}

function findWorkspaceSkillsDirs(workspaceRoot: string): string[] {
  const root = path.resolve(workspaceRoot);
  const found: string[] = [];
  const ignoredDirNames = new Set([
    ".git",
    ".next",
    ".turbo",
    ".wrangler",
    "coverage",
    "dist",
    "build",
    "node_modules",
  ]);

  const visit = (dir: string): void => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.name === "skills") {
        if (hasSkillFiles(fullPath)) {
          found.push(fullPath);
        }
        continue;
      }
      if (ignoredDirNames.has(entry.name)) continue;
      visit(fullPath);
    }
  };

  visit(root);
  return found;
}

function hasSkillFiles(dir: string): boolean {
  try {
    if (!fs.existsSync(dir)) return false;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (fs.existsSync(path.join(dir, entry.name, "SKILL.md"))) return true;
    }
    return false;
  } catch {
    return false;
  }
}
