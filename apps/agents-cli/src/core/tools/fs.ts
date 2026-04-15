import fs from "node:fs";
import path from "node:path";
import { ToolHandler } from "./registry.js";
import { invalidateToolCaches } from "./cache.js";
import { CapabilityGrant } from "../../types/index.js";
import type { FileReadUsage, FileReadWindow, ToolRuntimeState } from "./registry.js";

function readResourceWhitelist(meta: Record<string, unknown> | undefined): Record<string, unknown> | null {
  const raw = meta?.resourceWhitelist;
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
}

function isRemoteScopedUser(meta: Record<string, unknown> | undefined): boolean {
  return typeof meta?.userId === "string" && meta.userId.trim().length > 0;
}

function readLocalResourcePaths(meta: Record<string, unknown> | undefined): string[] {
  const raw = meta?.localResourcePaths;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const value = String(item || "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function readWorkspaceRoot(meta: Record<string, unknown> | undefined, cwd: string): string {
  const raw = typeof meta?.workspaceRoot === "string" ? meta.workspaceRoot.trim() : "";
  if (!raw) return cwd;
  return path.resolve(cwd, raw);
}

function readSharedWorkspaceRoot(meta: Record<string, unknown> | undefined): string {
  const raw = typeof meta?.sharedWorkspaceRoot === "string" ? meta.sharedWorkspaceRoot.trim() : "";
  return raw ? path.resolve(raw) : "";
}

function resolveLocalResourceRoots(meta: Record<string, unknown> | undefined, workspaceRoot: string): string[] {
  return readLocalResourcePaths(meta)
    .map((item) => path.resolve(workspaceRoot, item))
    .filter((item, index, array) => array.indexOf(item) === index);
}

function isRestrictRepoKnowledgeReadEnabled(meta: Record<string, unknown> | undefined): boolean {
  return readResourceWhitelist(meta)?.restrictRepoKnowledgeRead === true;
}

function isRepoKnowledgeReadEnabled(meta: Record<string, unknown> | undefined): boolean {
  const whitelist = readResourceWhitelist(meta);
  return whitelist?.restrictRepoKnowledgeRead === true || whitelist?.allowRepoKnowledgeRead === true;
}

function enforceRepoKnowledgePathPolicy(cwd: string, fullPath: string, target: string, meta?: Record<string, unknown>) {
  if (!isRestrictRepoKnowledgeReadEnabled(meta)) return;
  const rel = path.relative(cwd, fullPath).replace(/\\/g, "/");
  const allowedTopLevelRoots = new Set(["assets", "docs", "ai-metadata", "skills"]);
  const topLevel = rel.split("/").filter(Boolean)[0] || "";
  if (!topLevel || !allowedTopLevelRoots.has(topLevel)) {
    throw new Error(`Path not allowed under repo knowledge policy: ${target}`);
  }
  if (topLevel === "apps") {
    throw new Error(`Path not allowed under repo knowledge policy: ${target}`);
  }
}

function isInsideBase(baseDir: string, fullPath: string): boolean {
  const rel = path.relative(baseDir, fullPath);
  return !(rel.startsWith("..") || path.isAbsolute(rel));
}

function readCapabilityGrant(meta: Record<string, unknown> | undefined): CapabilityGrant | null {
  const raw = meta?.capabilityGrant;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const tools = Array.isArray(record.tools)
    ? record.tools.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const readableRoots = Array.isArray(record.readableRoots)
    ? record.readableRoots.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const writableRoots = Array.isArray(record.writableRoots)
    ? record.writableRoots.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  return {
    tools,
    readableRoots,
    writableRoots,
    network: record.network === "approved" ? "approved" : "none",
    budgets: {
      maxToolCalls: 32,
      maxTokens: 120000,
      maxWallTimeMs: 300000,
    },
  };
}

function enforceCapabilityPathPolicy(
  mode: "read" | "write",
  fullPath: string,
  target: string,
  meta: Record<string, unknown> | undefined
) {
  const grant = readCapabilityGrant(meta);
  if (!grant) return;
  const readableRoots = grant.readableRoots.map((item) => path.resolve(item));
  const writableRoots = grant.writableRoots.map((item) => path.resolve(item));
  const withinReadable = readableRoots.some((root) => isInsideBase(root, fullPath));
  const withinWritable = writableRoots.some((root) => isInsideBase(root, fullPath));
  if (mode === "read") {
    if (!withinReadable && !withinWritable) {
      throw new Error(`Path not allowed outside capability readableRoots: ${target}`);
    }
    return;
  }
  if (!withinWritable) {
    throw new Error(`Path not allowed outside capability writableRoots: ${target}`);
  }
}

function enforceLocalResourcePathPolicy(
  localRoots: string[],
  fullPath: string,
  target: string,
) {
  if (localRoots.length === 0) {
    throw new Error(`Path not allowed outside declared local resources: ${target}`);
  }
  if (!localRoots.some((root) => isInsideBase(root, fullPath))) {
    throw new Error(`Path not allowed outside declared local resources: ${target}`);
  }
}

function safeResolvePath(cwd: string, target: string, meta?: Record<string, unknown>, mode: "read" | "write" = "read") {
  const workspaceRoot = readWorkspaceRoot(meta, cwd);
  const sharedWorkspaceRoot = readSharedWorkspaceRoot(meta);
  const normalizedTarget = String(target || "").trim();
  const localRoots = resolveLocalResourceRoots(meta, workspaceRoot);
  if (!normalizedTarget) {
    throw new Error("Path is required");
  }
  if (path.isAbsolute(normalizedTarget)) {
    const absoluteTarget = path.resolve(normalizedTarget);
    if (localRoots.some((root) => isInsideBase(root, absoluteTarget))) {
      return absoluteTarget;
    }
  }
  const repoKnowledgeTopLevel = normalizedTarget.split("/").filter(Boolean)[0] || "";
  const wantsProjectData = repoKnowledgeTopLevel === "project-data";
  const sharedRepoTopLevels = new Set(["apps", "packages", "infra", "docs", "assets", "skills", "ai-metadata"]);
  const wantsSharedWorkspaceRead =
    mode === "read" &&
    !!sharedWorkspaceRoot &&
    sharedRepoTopLevels.has(repoKnowledgeTopLevel);
  const hasScopedLocalResources = isRemoteScopedUser(meta) && localRoots.length > 0;
  const preferWorkspaceRoot =
    (isRepoKnowledgeReadEnabled(meta) || hasScopedLocalResources) &&
    new Set(["assets", "docs", "ai-metadata", "skills"]).has(repoKnowledgeTopLevel);
  if (
    hasScopedLocalResources &&
    !wantsProjectData &&
    !new Set(["assets", "docs", "ai-metadata", "skills"]).has(repoKnowledgeTopLevel)
  ) {
    throw new Error(
      `Path not allowed outside repo knowledge roots or declared local resources: ${target}`
    );
  }
  const baseDir = wantsSharedWorkspaceRead
    ? sharedWorkspaceRoot
    : (preferWorkspaceRoot || wantsProjectData ? workspaceRoot : cwd);
  const fullPath = path.resolve(baseDir, normalizedTarget);
  if (!isInsideBase(baseDir, fullPath)) {
    throw new Error(`Path escapes workspace: ${target}`);
  }
  if (wantsProjectData) {
    enforceLocalResourcePathPolicy(localRoots, fullPath, target);
  }
  enforceRepoKnowledgePathPolicy(baseDir, fullPath, target, meta);
  enforceCapabilityPathPolicy(mode, fullPath, target, meta);
  return fullPath;
}

function getReadFileBudgetPerPath(): number {
  const raw = Number(process.env.AGENTS_READ_FILE_BUDGET_PER_PATH ?? 3);
  if (!Number.isFinite(raw)) return 3;
  return Math.max(1, Math.trunc(raw));
}

function ensureReadFileGuardState(state: ToolRuntimeState): {
  budgetPerPath: number;
  usageByPath: Map<string, FileReadUsage>;
} {
  const budgetPerPath =
    typeof state.guard.readFileBudgetPerPath === "number" && Number.isFinite(state.guard.readFileBudgetPerPath)
      ? Math.max(1, Math.trunc(state.guard.readFileBudgetPerPath))
      : getReadFileBudgetPerPath();
  state.guard.readFileBudgetPerPath = budgetPerPath;
  if (!(state.guard.readFileUsageByPath instanceof Map)) {
    state.guard.readFileUsageByPath = new Map<string, FileReadUsage>();
  }
  return {
    budgetPerPath,
    usageByPath: state.guard.readFileUsageByPath,
  };
}

function isRangeCovered(windows: FileReadWindow[], candidate: FileReadWindow): boolean {
  return windows.some((window) => {
    if (window.endLine === null) {
      return candidate.startLine >= window.startLine;
    }
    if (candidate.endLine === null) {
      return false;
    }
    return candidate.startLine >= window.startLine && candidate.endLine <= window.endLine;
  });
}

function registerFileRead(
  state: ToolRuntimeState,
  filePath: string,
  window: FileReadWindow,
): void {
  const guard = ensureReadFileGuardState(state);
  const usage = guard.usageByPath.get(filePath) ?? { reads: 0, windows: [] };

  if (isRangeCovered(usage.windows, window)) {
    const renderedWindow =
      window.endLine === null ? "full-file" : `${window.startLine}-${window.endLine}`;
    throw new Error(`Read budget blocked: ${filePath} already covers ${renderedWindow} in this run`);
  }
  if (usage.reads >= guard.budgetPerPath) {
    throw new Error(
      `Read budget blocked: ${filePath} exceeded per-file budget (${guard.budgetPerPath}) in this run`,
    );
  }

  usage.reads += 1;
  usage.windows.push(window);
  guard.usageByPath.set(filePath, usage);
}

export const readFileTool: ToolHandler = {
  definition: {
    name: "read_file",
    description: "读取文件内容。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "文件路径" },
        limit: { type: "integer", description: "最多读取行数" },
      },
      required: ["path"],
    },
  },
  async execute(args, ctx, toolCallId) {
    const filePath = safeResolvePath(ctx.cwd, String(args.path ?? ""), ctx.meta, "read");
    const limit = args.limit ? Number(args.limit) : undefined;
    const boundedLimit =
      typeof limit === "number" && Number.isFinite(limit) ? Math.max(1, Math.trunc(limit)) : undefined;

    registerFileRead(ctx.state, filePath, {
      startLine: 1,
      endLine: typeof boundedLimit === "number" ? boundedLimit : null,
    });

    const lines = fs.readFileSync(filePath, "utf-8").split("\n");
    const content = (boundedLimit ? lines.slice(0, boundedLimit) : lines).join("\n");
    const clipped = content.slice(0, 50000);
    return { toolCallId, content: clipped };
  },
};

export const readFileRangeTool: ToolHandler = {
  definition: {
    name: "read_file_range",
    description: "按行号范围读取文件内容（1-based，闭区间）。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "文件路径" },
        start_line: { type: "integer", description: "起始行号（从 1 开始）" },
        end_line: { type: "integer", description: "结束行号（包含）" },
      },
      required: ["path", "start_line", "end_line"],
    },
  },
  async execute(args, ctx, toolCallId) {
    const filePath = safeResolvePath(ctx.cwd, String(args.path ?? ""), ctx.meta, "read");
    const startLine = Math.max(1, Math.trunc(Number(args.start_line ?? 1)));
    const endLine = Math.max(startLine, Math.trunc(Number(args.end_line ?? startLine)));

    registerFileRead(ctx.state, filePath, {
      startLine,
      endLine,
    });

    const lines = fs.readFileSync(filePath, "utf-8").split("\n");
    const content = lines.slice(startLine - 1, endLine).join("\n");
    const clipped = content.slice(0, 50000);
    return { toolCallId, content: clipped };
  },
};

export const writeFileTool: ToolHandler = {
  definition: {
    name: "write_file",
    description: "写入文件内容（覆盖）。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "文件路径" },
        content: { type: "string", description: "写入内容" },
      },
      required: ["path", "content"],
    },
  },
  async execute(args, ctx, toolCallId) {
    const filePath = safeResolvePath(ctx.cwd, String(args.path ?? ""), ctx.meta, "write");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, String(args.content ?? ""), "utf-8");
    invalidateToolCaches(ctx.state);
    return { toolCallId, content: `Wrote ${String(args.content ?? "").length} bytes to ${args.path}` };
  },
};

export const appendFileTool: ToolHandler = {
  definition: {
    name: "append_file",
    description: "追加写入文件内容。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "文件路径" },
        content: { type: "string", description: "追加内容" },
      },
      required: ["path", "content"],
    },
  },
  async execute(args, ctx, toolCallId) {
    const filePath = safeResolvePath(ctx.cwd, String(args.path ?? ""), ctx.meta, "write");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, String(args.content ?? ""), "utf-8");
    invalidateToolCaches(ctx.state);
    return { toolCallId, content: `Appended ${String(args.content ?? "").length} bytes to ${args.path}` };
  },
};

export const editFileTool: ToolHandler = {
  definition: {
    name: "edit_file",
    description: "替换文件中的文本（首次匹配）。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "文件路径" },
        old_text: { type: "string", description: "要替换的文本" },
        new_text: { type: "string", description: "替换后的文本" },
      },
      required: ["path", "old_text", "new_text"],
    },
  },
  async execute(args, ctx, toolCallId) {
    const filePath = safeResolvePath(ctx.cwd, String(args.path ?? ""), ctx.meta, "write");
    const oldText = String(args.old_text ?? "");
    const newText = String(args.new_text ?? "");
    const content = fs.readFileSync(filePath, "utf-8");
    if (!content.includes(oldText)) {
      return { toolCallId, content: `Error: Text not found in ${args.path}` };
    }
    const updated = content.replace(oldText, newText);
    fs.writeFileSync(filePath, updated, "utf-8");
    invalidateToolCaches(ctx.state);
    return { toolCallId, content: `Edited ${args.path}` };
  },
};
