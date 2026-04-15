import path from "node:path";
import { CapabilityGrant } from "../../types/index.js";

function stripQuotedSegments(command: string): string {
  let out = "";
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;
  for (const ch of command) {
    if (escaped) {
      escaped = false;
      if (!quote) out += ch;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      if (!quote) out += ch;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }
    out += ch;
  }
  return out;
}

function isRemoteScopedUser(meta: Record<string, unknown> | undefined): boolean {
  return typeof meta?.userId === "string" && meta.userId.trim().length > 0;
}

function readWorkspaceRoot(meta: Record<string, unknown> | undefined, cwd: string): string {
  const raw = typeof meta?.workspaceRoot === "string" ? meta.workspaceRoot.trim() : "";
  if (!raw) return cwd;
  return path.resolve(cwd, raw);
}

function readLocalResourcePaths(meta: Record<string, unknown> | undefined, cwd: string): string[] {
  const workspaceRoot = readWorkspaceRoot(meta, cwd);
  const raw = meta?.localResourcePaths;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const value = String(item || "").trim();
    if (!value) continue;
    const resolved = path.resolve(workspaceRoot, value);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    out.push(resolved);
  }
  return out;
}

function extractProjectDataPathMentions(command: string): string[] {
  const rawTokens = command.match(/'[^']*'|"[^"]*"|`[^`]*`|[^\s"'`]+/g) ?? [];
  const mentions: string[] = [];
  for (const token of rawTokens) {
    const cleaned = token.replace(/^[({\['"`]+|[)\]};,'"``]+$/g, "");
    if (!cleaned.includes("project-data")) continue;
    mentions.push(cleaned);
  }
  return mentions;
}

function commandTouchesFilesystem(command: string): boolean {
  const unquoted = stripQuotedSegments(command);
  return /\b(find|cat|ls|rg|sed|head|tail|wc|stat|test|grep|awk|sort|readlink)\b/.test(unquoted);
}

function normalizeProjectDataMention(
  mention: string,
  workspaceRoot: string
): { absolutePath: string; exact: boolean } | null {
  const compact = mention.replace(/\\/g, "/");
  if (!compact.includes("project-data")) return null;
  if (/[*?[\]]/.test(compact)) {
    return null;
  }
  const marker = "/project-data/";
  const markerIndex = compact.indexOf(marker);
  if (markerIndex >= 0) {
    const suffix = compact.slice(markerIndex + marker.length).replace(/^\/+/, "");
    return {
      absolutePath: path.resolve(workspaceRoot, "project-data", suffix),
      exact: suffix.length > 0,
    };
  }
  if (compact === "project-data" || compact.endsWith("/project-data")) {
    return {
      absolutePath: path.resolve(workspaceRoot, "project-data"),
      exact: false,
    };
  }
  const relativeIndex = compact.indexOf("project-data/");
  if (relativeIndex >= 0) {
    const suffix = compact.slice(relativeIndex + "project-data/".length).replace(/^\/+/, "");
    return {
      absolutePath: path.resolve(workspaceRoot, "project-data", suffix),
      exact: suffix.length > 0,
    };
  }
  return null;
}

function readCapabilityGrant(meta: Record<string, unknown> | undefined): CapabilityGrant | null {
  const raw = meta?.capabilityGrant;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  return {
    tools: Array.isArray(record.tools) ? record.tools.map((item) => String(item || "").trim()).filter(Boolean) : [],
    readableRoots: Array.isArray(record.readableRoots)
      ? record.readableRoots.map((item) => String(item || "").trim()).filter(Boolean)
      : [],
    writableRoots: Array.isArray(record.writableRoots)
      ? record.writableRoots.map((item) => String(item || "").trim()).filter(Boolean)
      : [],
    network: record.network === "approved" ? "approved" : "none",
    budgets: {
      maxToolCalls: 32,
      maxTokens: 120000,
      maxWallTimeMs: 300000,
    },
  };
}

function looksLikeWriteCommand(command: string): boolean {
  const unquoted = stripQuotedSegments(command);
  return (
    />/.test(unquoted) ||
    /\b(rm|mv|cp|mkdir|touch|install|tee)\b/.test(unquoted) ||
    /\bsed\b[\s\S]*\s-i\b/.test(unquoted)
  );
}

function extractFilesystemPathMentions(command: string): string[] {
  const rawTokens = command.match(/'[^']*'|"[^"]*"|`[^`]*`|[^\s"'`]+/g) ?? [];
  const mentions: string[] = [];
  for (const token of rawTokens) {
    const cleaned = token.replace(/^[({\['"`]+|[)\]};,'"``]+$/g, "");
    if (!cleaned || cleaned.startsWith("-")) continue;
    if (
      cleaned === "." ||
      cleaned === ".." ||
      cleaned.startsWith("./") ||
      cleaned.startsWith("../") ||
      cleaned.startsWith("/") ||
      cleaned.startsWith("project-data/") ||
      cleaned.startsWith("apps/") ||
      cleaned.startsWith("packages/") ||
      cleaned.startsWith("infra/") ||
      cleaned.startsWith("docs/") ||
      cleaned.startsWith("assets/") ||
      cleaned.startsWith("skills/") ||
      cleaned.startsWith("ai-metadata/")
    ) {
      mentions.push(cleaned);
    }
  }
  return mentions;
}

function isInsideBase(baseDir: string, fullPath: string): boolean {
  const rel = path.relative(baseDir, fullPath);
  return !(rel.startsWith("..") || path.isAbsolute(rel));
}

function normalizeMentionToAbsolute(
  mention: string,
  workspaceRoot: string,
  cwd: string
): string {
  if (path.isAbsolute(mention)) return path.resolve(mention);
  if (
    mention.startsWith("project-data/") ||
    mention.startsWith("apps/") ||
    mention.startsWith("packages/") ||
    mention.startsWith("infra/") ||
    mention.startsWith("docs/") ||
    mention.startsWith("assets/") ||
    mention.startsWith("skills/") ||
    mention.startsWith("ai-metadata/")
  ) {
    return path.resolve(workspaceRoot, mention);
  }
  return path.resolve(cwd, mention);
}

export function isRestrictRepoKnowledgeReadEnabled(meta: Record<string, unknown> | undefined): boolean {
  const raw = meta?.resourceWhitelist;
  const whitelist = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  return whitelist?.restrictRepoKnowledgeRead === true;
}

export function isDangerousShellCommand(command: string): boolean {
  return command.includes("rm -rf /") || command.includes("sudo") || command.includes("shutdown");
}

export function enforceScopedSearchPolicy(command: string, meta: Record<string, unknown> | undefined): string | null {
  if (!isRemoteScopedUser(meta) || !Array.isArray(meta?.localResourcePaths) || meta.localResourcePaths.length === 0) {
    return null;
  }
  const unquoted = stripQuotedSegments(command);
  const broadTraversalPatterns = [
    /\bfind\s+\./,
    /\bfind\s+\.\./,
    /\bls\s+\.\./,
    /\brg\b[\s\S]*\bapps\b/,
    /\brg\b[\s\S]*\bpackages\b/,
    /\brg\b[\s\S]*\.agents\b/,
    /\bfind\b[\s\S]*\bapps\b/,
    /\bfind\b[\s\S]*\bpackages\b/,
    /\bfind\b[\s\S]*\.agents\b/,
  ];
  if (broadTraversalPatterns.some((pattern) => pattern.test(unquoted))) {
    return "Error: bash command escapes scoped local evidence gathering. When localResourcePaths are present, search only inside declared project-data subtrees or repo knowledge roots.";
  }
  return null;
}

export function enforceProjectDataCommandPolicy(
  command: string,
  meta: Record<string, unknown> | undefined,
  cwd: string
): string | null {
  const localRoots = readLocalResourcePaths(meta, cwd);
  if (localRoots.length === 0) return null;
  if (!command.includes("project-data")) return null;
  if (!commandTouchesFilesystem(command)) return null;
  const workspaceRoot = readWorkspaceRoot(meta, cwd);
  const mentions = extractProjectDataPathMentions(command);
  if (mentions.length === 0) {
    return "Error: bash command touches project-data ambiguously. Use an explicit path inside allowed localResourcePaths.";
  }
  for (const mention of mentions) {
    const normalized = normalizeProjectDataMention(mention, workspaceRoot);
    if (!normalized) {
      return `Error: bash command uses unsupported project-data pattern: ${mention}`;
    }
    if (!normalized.exact) {
      return `Error: bash command must target a specific declared project-data subtree, not ${mention}.`;
    }
    if (!localRoots.some((root) => isInsideBase(root, normalized.absolutePath))) {
      return `Error: bash command path not allowed outside declared local resources: ${mention}`;
    }
  }
  return null;
}

export function enforceCapabilityShellPolicy(
  command: string,
  meta: Record<string, unknown> | undefined,
  cwd: string
): string | null {
  const grant = readCapabilityGrant(meta);
  if (!grant) return null;
  const readableRoots = grant.readableRoots.map((item) => path.resolve(item));
  const writableRoots = grant.writableRoots.map((item) => path.resolve(item));
  const writeCommand = looksLikeWriteCommand(command);
  if (writeCommand && writableRoots.length === 0) {
    return "Error: bash write command blocked by capability writableRoots.";
  }
  const mentions = extractFilesystemPathMentions(command);
  if (mentions.length === 0) return null;
  const workspaceRoot = readWorkspaceRoot(meta, cwd);
  for (const mention of mentions) {
    const absolutePath = normalizeMentionToAbsolute(mention, workspaceRoot, cwd);
    if (writeCommand) {
      if (!writableRoots.some((root) => isInsideBase(root, absolutePath))) {
        return `Error: bash path not allowed outside capability writableRoots: ${mention}`;
      }
      continue;
    }
    const allowedRoots = [...readableRoots, ...writableRoots];
    if (!allowedRoots.some((root) => isInsideBase(root, absolutePath))) {
      return `Error: bash path not allowed outside capability readableRoots: ${mention}`;
    }
  }
  return null;
}

export function buildAgentShellEnv(meta: Record<string, unknown> | undefined): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...(typeof meta?.agentWorkRoot === "string" && meta.agentWorkRoot.trim()
      ? { AGENT_WORK_ROOT: meta.agentWorkRoot.trim() }
      : {}),
    ...(typeof meta?.repoStageRoot === "string" && meta.repoStageRoot.trim()
      ? { AGENT_REPO_STAGING_ROOT: meta.repoStageRoot.trim() }
      : {}),
    ...(typeof meta?.sharedWorkspaceRoot === "string" && meta.sharedWorkspaceRoot.trim()
      ? { AGENTS_SHARED_WORKSPACE_ROOT: meta.sharedWorkspaceRoot.trim() }
      : {}),
  };
}
