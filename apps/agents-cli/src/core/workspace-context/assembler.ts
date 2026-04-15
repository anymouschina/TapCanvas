import fs from "node:fs";
import path from "node:path";

import type { EvidenceBundle } from "../../types/index.js";
import type { ResolveWorkspaceContextParams, WorkspaceContext, WorkspaceContextFile } from "./types.js";

const PERSONA_CONTEXT_FILES = ["IDENTITY.md", "SOUL.md"] as const;
const ROOT_CONTEXT_FILES = [
  "AGENTS.md",
  "PROJECT.md",
  "RULES.md",
  "STYLE.md",
  "CHARACTERS.md",
  "STORY_STATE.md",
  "TOOLS.md",
] as const;
const CONTEXT_DIR_PRIORITY_FILES = [
  "GLOBAL_RULES.md",
  "PROJECT.md",
  "RULES.md",
  "STYLE.md",
  "CHARACTERS.md",
  "STORY_STATE.md",
  "TOOLS.md",
] as const;

const CONTEXT_DIR_CANDIDATES = [".agents/context"] as const;

const DEFAULT_MAX_CHARS_PER_FILE = 3_000;
const DEFAULT_MAX_TOTAL_CHARS = 12_000;

export async function resolveWorkspaceContext(
  params: ResolveWorkspaceContextParams,
): Promise<WorkspaceContext> {
  const rootDir = resolveRootDir(params);
  const candidates = collectCandidatePaths(rootDir, params.resourceRoots ?? []);
  const files = loadContextFiles(candidates, {
    maxCharsPerFile: params.maxCharsPerFile ?? DEFAULT_MAX_CHARS_PER_FILE,
    maxTotalChars: params.maxTotalChars ?? DEFAULT_MAX_TOTAL_CHARS,
    rootDir,
  });
  const evidenceBundles = buildEvidenceBundles(files);

  return {
    rootDir,
    files,
    evidenceBundles,
    promptFragment: buildPromptFragment(rootDir, evidenceBundles),
    summary: buildSummary(rootDir, evidenceBundles),
  };
}

function resolveRootDir(params: ResolveWorkspaceContextParams): string {
  const workspaceRoot = String(params.workspaceRoot || "").trim();
  if (workspaceRoot) {
    return path.resolve(params.cwd, workspaceRoot);
  }
  return path.resolve(params.cwd);
}

function collectCandidatePaths(rootDir: string, resourceRoots: string[]): string[] {
  const candidatePaths: string[] = [];
  const seenPaths = new Set<string>();
  const roots = [resolveCwdContextRoot(), rootDir, ...resourceRoots]
    .map((value) => path.resolve(value))
    .filter((value, index, array) => array.indexOf(value) === index);
  const pushCandidate = (candidatePath: string) => {
    if (seenPaths.has(candidatePath)) return;
    seenPaths.add(candidatePath);
    candidatePaths.push(candidatePath);
  };
  for (const candidateRoot of roots) {
    for (const fileName of PERSONA_CONTEXT_FILES) {
      pushCandidate(path.join(candidateRoot, fileName));
    }
  }
  for (const candidateRoot of roots) {
    for (const fileName of ROOT_CONTEXT_FILES) {
      pushCandidate(path.join(candidateRoot, fileName));
    }
  }
  for (const candidateRoot of roots) {
    for (const dirName of CONTEXT_DIR_CANDIDATES) {
      const dirPath = path.join(candidateRoot, dirName);
      if (!fs.existsSync(dirPath)) continue;
      let entries: string[] = [];
      try {
        entries = fs.readdirSync(dirPath);
      } catch {
        continue;
      }
      for (const entry of sortContextDirEntries(entries)) {
        if (!entry.toLowerCase().endsWith(".md")) continue;
        pushCandidate(path.join(dirPath, entry));
      }
    }
  }
  return candidatePaths;
}

function resolveCwdContextRoot(): string {
  try {
    return process.cwd();
  } catch {
    return ".";
  }
}

function loadContextFiles(
  candidates: string[],
  options: { maxCharsPerFile: number; maxTotalChars: number; rootDir: string },
): WorkspaceContextFile[] {
  const files: WorkspaceContextFile[] = [];
  let totalChars = 0;

  for (const candidate of candidates) {
    if (totalChars >= options.maxTotalChars) break;
    if (!fs.existsSync(candidate)) continue;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(candidate);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    let raw = "";
    try {
      raw = fs.readFileSync(candidate, "utf-8");
    } catch {
      continue;
    }
    const normalized = String(raw || "").trim();
    if (!normalized) continue;
    const remaining = Math.max(0, options.maxTotalChars - totalChars);
    const charBudget = Math.min(options.maxCharsPerFile, remaining);
    if (charBudget <= 0) break;
    const content = truncate(normalized, charBudget);
    totalChars += content.length;
    files.push({
      name: path.basename(candidate),
      path: toDisplayPath(options.rootDir, candidate),
      content,
      charCount: content.length,
    });
  }

  return files;
}

function toDisplayPath(rootDir: string, candidate: string): string {
  const relative = path.relative(rootDir, candidate);
  if (!relative || relative === "") return path.basename(candidate);
  if (relative.startsWith("..")) return candidate;
  return relative;
}

function buildEvidenceBundles(files: WorkspaceContextFile[]): EvidenceBundle[] {
  return files.map((file, index) => ({
    id: `ev_${index + 1}`,
    kind: isPersonaFile(file.name) ? "persona" : "workspace_rule",
    source: file.path,
    summary: `${file.name} (${file.charCount} chars)`,
    content: file.content,
    visibility: isPersonaFile(file.name) ? "all" : "all",
  }));
}

function buildPromptFragment(rootDir: string, evidenceBundles: EvidenceBundle[]): string {
  if (evidenceBundles.length === 0) return "";
  const personaFiles = evidenceBundles.filter((file) => file.kind === "persona");
  const workspaceFiles = evidenceBundles.filter((file) => file.kind !== "persona");
  const sections: string[] = [];
  if (personaFiles.length > 0) {
    const personaLines = [
      "## Persona Context",
      "以下文件定义助手身份、判断方式与协作风格；它们不是项目资料，必须持续优先生效：",
    ];
    for (const file of personaFiles) {
      personaLines.push(`### ${path.basename(file.source)} (${file.source})`);
      personaLines.push(file.content);
    }
    sections.push(personaLines.join("\n\n"));
  }
  if (workspaceFiles.length > 0) {
    const workspaceLines = [
      "## Workspace Context",
      `workspaceRoot: ${rootDir}`,
      "以下文件为本次运行的项目/工作区上下文，优先视为项目事实与约束：",
    ];
    for (const file of workspaceFiles) {
      workspaceLines.push(`### ${path.basename(file.source)} (${file.source})`);
      workspaceLines.push(file.content);
    }
    sections.push(workspaceLines.join("\n\n"));
  }
  return sections.join("\n\n").trim();
}

function buildSummary(rootDir: string, evidenceBundles: EvidenceBundle[]): string {
  if (evidenceBundles.length === 0) {
    return `workspaceRoot=${rootDir}; contextFiles=0`;
  }
  const names = evidenceBundles.map((file) => file.source).join(", ");
  return `workspaceRoot=${rootDir}; contextFiles=${evidenceBundles.length}; files=${names}`;
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  if (maxChars <= 1) return value.slice(0, maxChars);
  return `${value.slice(0, maxChars - 1).trimEnd()}…`;
}

function isPersonaFile(fileName: string): boolean {
  return PERSONA_CONTEXT_FILES.some((item) => item.toLowerCase() === fileName.toLowerCase());
}

function sortContextDirEntries(entries: string[]): string[] {
  const priority = new Map<string, number>(
    CONTEXT_DIR_PRIORITY_FILES.map((fileName, index) => [fileName.toLowerCase(), index]),
  );
  return [...entries].sort((left, right) => {
    const leftPriority = priority.get(left.toLowerCase());
    const rightPriority = priority.get(right.toLowerCase());
    if (typeof leftPriority === "number" && typeof rightPriority === "number") {
      return leftPriority - rightPriority;
    }
    if (typeof leftPriority === "number") return -1;
    if (typeof rightPriority === "number") return 1;
    return left.localeCompare(right);
  });
}
