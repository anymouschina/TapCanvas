import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { ToolRuntimeState } from "../tools/registry.js";
import { AgentRunner } from "../agent-loop.js";
import {
  AgentType,
  CHILD_DELEGATION_BLOCKED_TOOLS,
  getToolsForAgent,
} from "../subagent/types.js";
import { getAgentDefinition } from "../subagent/definitions.js";
import { Message } from "../../types/index.js";
import {
  AgentExecutionMode,
  AgentIsolationMode,
  CapabilityGrant,
  CapabilityProviderKind,
} from "../../types/index.js";
import { WorldLogger } from "../logs/world-logger.js";
import {
  CollabRuntimeStore,
  PersistedAgentRecord,
  PersistedSubmissionRecord,
} from "./runtime-store.js";
import {
  CollabMailboxStore,
  PersistedMailboxMessage,
} from "./mailbox-store.js";
import {
  CollabProtocolStore,
  PersistedProtocolRequest,
  PersistedProtocolResponseStatus,
} from "./protocol-store.js";
import {
  AgentArtifactSummary,
  AgentStatusSummary,
  AgentWorkspaceHandoffFile,
  AgentWorkspaceImportConflictPolicy,
  AgentWorkspaceImportSummary,
  CollabAgentManagerLike,
  SubmissionStatusSummary,
} from "./public.js";

type AgentStatus = "queued" | "running" | "idle" | "completed" | "failed" | "closed";
type SubmissionStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

type SubmissionRecord = {
  id: string;
  agentId: string;
  prompt: string;
  status: SubmissionStatus;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
  result?: string;
  error?: string;
  runStartedAt?: string;
  budgetMs?: number;
  lastProgressAt?: string;
  lastProgressSummary?: string;
};

type AgentRecord = {
  id: string;
  description: string;
  agentType: AgentType;
  executionMode: AgentExecutionMode;
  isolationMode: AgentIsolationMode;
  skillBundle?: string[];
  capabilityProviderBundle?: CapabilityProviderKind[];
  capabilityGrant: CapabilityGrant;
  modelOverride?: string;
  systemOverride?: string;
  agentWorkRoot: string;
  autonomous: boolean;
  claimedTaskId?: string;
  idleSince?: string;
  idleRequested?: boolean;
  depth: number;
  parentAgentId?: string;
  history: Message[];
  status: AgentStatus;
  createdAt: string;
  updatedAt: string;
  pendingTasks: number;
  completedTasks: number;
  lastSubmissionId?: string;
  activeSubmissionId?: string;
  recentSubmissionIds: string[];
  lastResult?: string;
  lastError?: string;
  closed: boolean;
  chain: Promise<void>;
  getDrainPromise: () => Promise<void>;
};

type CollabRuntime = {
  runner: AgentRunner;
  cwd: string;
  systemOverride: string;
  maxDepth: number;
  baseCapabilityGrant: CapabilityGrant;
  tasks: import("../tasks/store.js").TaskStore;
  store: CollabRuntimeStore;
  mailbox: CollabMailboxStore;
  protocol: CollabProtocolStore;
  worldApiUrl?: string;
  parentLoggerId?: string;
  processName?: string;
};

const REPO_STAGE_DIRNAME = "repo";
const RESERVED_IMPORT_SEGMENTS = new Set([".agents", ".git"]);

function isFinal(status: AgentStatus) {
  return status === "completed" || status === "failed" || status === "closed";
}

function readEnvMs(name: string, fallback: number): number {
  const raw = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(raw) || raw < 0) return fallback;
  return Math.trunc(raw);
}

function getSubagentRunBudgetMs(grant: CapabilityGrant): number {
  const override = readEnvMs("AGENTS_SUBAGENT_RUN_BUDGET_MS", 0);
  if (override > 0) return override;
  return Math.max(1_000, Number(grant.budgets.maxWallTimeMs || 0) || 300_000);
}

function getSubagentProgressPersistMs(): number {
  return Math.max(250, readEnvMs("AGENTS_SUBAGENT_PROGRESS_PERSIST_MS", 2_000));
}

function buildInitialProgressSummary(): string {
  return "子代理已启动，尚无后续 tool 或文本进展事件。";
}

function buildToolProgressSummary(toolCall: {
  name: string;
  status: string;
  args: Record<string, unknown>;
}): string {
  const promptLike = typeof toolCall.args.prompt === "string"
    ? toolCall.args.prompt.trim()
    : "";
  const promptPreview = promptLike ? preview(promptLike, 80) : "";
  return [
    `tool=${toolCall.name}`,
    `status=${toolCall.status}`,
    ...(promptPreview ? [`prompt=${promptPreview}`] : []),
  ].join(" ");
}

function buildTextProgressSummary(charCount: number): string {
  return `text_delta chars=${Math.max(0, Math.trunc(charCount))}`;
}

function preview(text: string | undefined, maxLen = 800) {
  const raw = String(text ?? "");
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return trimmed.length > maxLen ? `${trimmed.slice(0, maxLen)}…` : trimmed;
}

function cloneHistory(history: Message[]): Message[] {
  return history.map((message) => ({
    role: message.role,
    content: message.content,
    ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
    ...(message.toolCalls
      ? {
          toolCalls: message.toolCalls.map((toolCall) => ({
            id: toolCall.id,
            name: toolCall.name,
            arguments: toolCall.arguments,
          })),
        }
      : {}),
  }));
}

function uniqueStrings(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function resolveAgentRequiredSkills(params: {
  definitionSkillBundle?: string[];
  inheritedRequiredSkills?: string[];
}): string[] {
  return uniqueStrings([
    ...(params.definitionSkillBundle ?? []),
    ...(params.inheritedRequiredSkills ?? []),
  ]);
}

function resolveAgentModelOverride(params: {
  inheritedModelOverride?: string;
  definitionModelPolicy?: {
    inheritFromParent?: boolean;
    defaultModel?: string;
  };
}): string | undefined {
  const inheritedModel = String(params.inheritedModelOverride || "").trim();
  const defaultModel = String(params.definitionModelPolicy?.defaultModel || "").trim();
  if (defaultModel) {
    return defaultModel;
  }
  if (params.definitionModelPolicy?.inheritFromParent === true) {
    return inheritedModel || undefined;
  }
  return inheritedModel || undefined;
}

function narrowCapabilityGrantForAgent(grant: CapabilityGrant, _agentType: AgentType): CapabilityGrant {
  const readableRoots = uniqueStrings([...grant.readableRoots, ...grant.writableRoots]);
  const writableRoots = uniqueStrings(grant.writableRoots);
  return {
    tools: uniqueStrings(grant.tools).filter(
      (toolName) =>
        !CHILD_DELEGATION_BLOCKED_TOOLS.includes(
          toolName as (typeof CHILD_DELEGATION_BLOCKED_TOOLS)[number]
        )
    ),
    readableRoots,
    writableRoots,
    network: grant.network,
    budgets: {
      ...grant.budgets,
    },
  };
}

function allocateAgentWorkRoot(workspaceRoot: string, agentId: string): string {
  const workRoot = path.join(workspaceRoot, ".agents", "runtime", "collab", "workspaces", agentId);
  fs.mkdirSync(workRoot, { recursive: true });
  return workRoot;
}

function getAgentRepoStageRoot(agentWorkRoot: string): string {
  const repoRoot = path.join(agentWorkRoot, REPO_STAGE_DIRNAME);
  fs.mkdirSync(repoRoot, { recursive: true });
  return repoRoot;
}

function writeAgentWorkRootManifest(agentWorkRoot: string, sharedWorkspaceRoot: string): void {
  const manifestPath = path.join(agentWorkRoot, "AGENT_WORKSPACE.md");
  const repoStageRoot = getAgentRepoStageRoot(agentWorkRoot);
  const body = [
    "# Agent Workspace",
    "",
    `agentWorkRoot: ${agentWorkRoot}`,
    `repoStageRoot: ${repoStageRoot}`,
    `sharedWorkspaceRoot: ${sharedWorkspaceRoot}`,
    "",
    "- Write notes, patches, and intermediate outputs inside agentWorkRoot.",
    "- Write repo files intended for orchestrator import inside repoStageRoot.",
    "- Treat sharedWorkspaceRoot as read-only unless capability writableRoots explicitly allow more.",
  ].join("\n");
  fs.writeFileSync(manifestPath, `${body}\n`, "utf-8");
}

function collectAgentArtifacts(agentWorkRoot: string, limit = 12): AgentArtifactSummary[] {
  const artifacts: AgentArtifactSummary[] = [];
  const walk = (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (artifacts.length >= limit) return;
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(agentWorkRoot, fullPath).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (relPath === "AGENT_WORKSPACE.md" || relPath === "artifacts.json") continue;
      const stats = fs.statSync(fullPath);
      artifacts.push({
        path: relPath,
        bytes: stats.size,
      });
    }
  };
  if (!fs.existsSync(agentWorkRoot)) return [];
  walk(agentWorkRoot);
  return artifacts;
}

function writeAgentArtifactManifest(agentWorkRoot: string): void {
  const artifacts = collectAgentArtifacts(agentWorkRoot, 200);
  const manifestPath = path.join(agentWorkRoot, "artifacts.json");
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), artifacts }, null, 2)}\n`,
    "utf-8"
  );
}

function sha256ForFile(filePath: string): string {
  const hash = createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function collectWorkspaceHandoffFiles(
  agentWorkRoot: string,
  sharedWorkspaceRoot: string,
  limit = 200
): AgentWorkspaceHandoffFile[] {
  const repoRoot = getAgentRepoStageRoot(agentWorkRoot);
  if (!fs.existsSync(repoRoot)) return [];
  const files: AgentWorkspaceHandoffFile[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= limit) return;
      const fullPath = path.join(dir, entry.name);
      try {
        if (entry.isSymbolicLink()) {
          continue;
        }
        if (entry.isDirectory()) {
          walk(fullPath);
          continue;
        }
        if (!entry.isFile()) {
          continue;
        }
        const relPath = normalizeImportedRelativePath(path.relative(repoRoot, fullPath));
        const targetPath = path.join(sharedWorkspaceRoot, relPath);
        const stats = fs.statSync(fullPath);
        const sourceSha256 = sha256ForFile(fullPath);
        const targetExists = fs.existsSync(targetPath);
        const targetStats = targetExists ? fs.statSync(targetPath) : null;
        const targetSha256 = targetExists && targetStats?.isFile() ? sha256ForFile(targetPath) : undefined;
        const importDecision = !targetExists
          ? "create"
          : targetSha256 === sourceSha256
            ? "unchanged"
            : "conflict";
        files.push({
          relative_path: relPath,
          source_path: fullPath,
          target_path: targetPath,
          bytes: stats.size,
          source_sha256: sourceSha256,
          target_exists: targetExists,
          ...(targetStats?.isFile() ? { target_bytes: targetStats.size } : {}),
          ...(targetSha256 ? { target_sha256: targetSha256 } : {}),
          import_decision: importDecision,
        });
      } catch {
        continue;
      }
    }
  };
  walk(repoRoot);
  return files;
}

function normalizeImportedRelativePath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/").trim();
  if (!normalized || normalized === ".") {
    throw new Error("workspace import path cannot be empty");
  }
  if (normalized.startsWith("/") || normalized.split("/").some((segment) => segment === "..")) {
    throw new Error(`workspace import path escapes repo root: ${normalized}`);
  }
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0) {
    throw new Error("workspace import path cannot be empty");
  }
  if (segments.some((segment) => RESERVED_IMPORT_SEGMENTS.has(segment))) {
    throw new Error(`workspace import path targets reserved workspace state: ${normalized}`);
  }
  return segments.join("/");
}

function writeWorkspaceHandoffManifest(agentWorkRoot: string, sharedWorkspaceRoot: string): void {
  const manifestPath = path.join(agentWorkRoot, "handoff.json");
  const files = collectWorkspaceHandoffFiles(agentWorkRoot, sharedWorkspaceRoot);
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), files }, null, 2)}\n`,
    "utf-8"
  );
}

function summarizeWorkspaceImport(
  files: AgentWorkspaceHandoffFile[],
  copiedCount: number,
  skippedCount: number
): AgentWorkspaceImportSummary {
  let createCount = 0;
  let unchangedCount = 0;
  let conflictCount = 0;
  for (const file of files) {
    if (file.import_decision === "create") createCount += 1;
    else if (file.import_decision === "unchanged") unchangedCount += 1;
    else if (file.import_decision === "conflict") conflictCount += 1;
  }
  return {
    file_count: files.length,
    create_count: createCount,
    unchanged_count: unchangedCount,
    conflict_count: conflictCount,
    copied_count: copiedCount,
    skipped_count: skippedCount,
  };
}

function getAgentWorkspaceLane(record: AgentRecord): string {
  return record.agentType === "worker"
    ? getAgentRepoStageRoot(record.agentWorkRoot)
    : record.agentWorkRoot;
}

export class CollabAgentManager implements CollabAgentManagerLike {
  private agents = new Map<string, AgentRecord>();
  private submissions = new Map<string, SubmissionRecord>();
  private autonomyTimers = new Map<string, NodeJS.Timeout>();
  private statusListeners = new Map<string, Set<() => void>>();

  constructor(private runtime: CollabRuntime) {}

  spawn(options: {
    description: string;
    prompt: string;
    agentType: AgentType;
    capabilityGrant?: CapabilityGrant;
    requiredSkills?: string[];
    modelOverride?: string;
    systemOverride?: string;
    autonomous?: boolean;
    taskId?: string;
    depth: number;
    parentAgentId?: string;
    initialHistory?: Message[];
  }) {
    const id = randomUUID();
    const now = new Date().toISOString();
    const initialPrompt = String(options.prompt || "").trim();
    if (!initialPrompt) throw new Error("empty prompt");
    const history = cloneHistory(options.initialHistory ?? []);
    const definition = getAgentDefinition(options.agentType);
    const requiredSkills = resolveAgentRequiredSkills({
      definitionSkillBundle: definition?.skillBundle,
      inheritedRequiredSkills: options.requiredSkills,
    });
    const modelOverride = resolveAgentModelOverride({
      inheritedModelOverride: options.modelOverride,
      definitionModelPolicy: definition?.modelPolicy,
    });
    const agentWorkRoot = path.join(
      this.runtime.cwd,
      ".agents",
      "runtime",
      "collab",
      "workspaces",
      id,
    );
    const baseGrant = options.capabilityGrant ?? this.runtime.baseCapabilityGrant;
    const record: AgentRecord = {
      id,
      description: options.description || options.agentType,
      agentType: options.agentType,
      executionMode: definition?.executionMode ?? "direct",
      isolationMode: definition?.isolationMode ?? "shared_workspace",
      ...(requiredSkills.length > 0 ? { skillBundle: requiredSkills } : {}),
      ...(definition?.capabilityProviderBundle?.length
        ? { capabilityProviderBundle: [...definition.capabilityProviderBundle] }
        : {}),
      capabilityGrant: narrowCapabilityGrantForAgent(
        {
          ...baseGrant,
          readableRoots: uniqueStrings([
            ...baseGrant.readableRoots,
            ...baseGrant.writableRoots,
            this.runtime.cwd,
            agentWorkRoot,
          ]),
          writableRoots: uniqueStrings([...baseGrant.writableRoots, agentWorkRoot]),
        },
        options.agentType
      ),
      ...(modelOverride ? { modelOverride } : {}),
      ...(options.systemOverride ? { systemOverride: options.systemOverride } : {}),
      agentWorkRoot,
      autonomous: options.autonomous === true,
      depth: options.depth,
      ...(options.parentAgentId ? { parentAgentId: options.parentAgentId } : {}),
      history,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      pendingTasks: 0,
      completedTasks: 0,
      recentSubmissionIds: [],
      closed: false,
      chain: Promise.resolve(),
      getDrainPromise: () => record.chain,
    };

    this.bindClaimedTask(record, options.taskId);
    fs.mkdirSync(agentWorkRoot, { recursive: true });
    writeAgentWorkRootManifest(agentWorkRoot, this.runtime.cwd);
    this.agents.set(id, record);
    this.ensureAutonomyLoop(record);
    const { submissionId } = this.enqueue(id, initialPrompt);
    return { agentId: id, submissionId };
  }

  enqueue(id: string, prompt: string) {
    const record = this.agents.get(id);
    if (!record) throw new Error(`agent not found: ${id}`);
    if (record.closed) throw new Error(`agent is closed: ${id}`);
    const taskPrompt = String(prompt || "").trim();
    if (!taskPrompt) throw new Error("empty prompt");
    const submissionId = randomUUID();
    const now = new Date().toISOString();
    const submission: SubmissionRecord = {
      id: submissionId,
      agentId: id,
      prompt: taskPrompt,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    };
    this.submissions.set(submissionId, submission);
    this.persistSubmission(submission);
    record.idleSince = undefined;
    record.idleRequested = undefined;
    record.pendingTasks += 1;
    record.lastSubmissionId = submissionId;
    record.recentSubmissionIds.push(submissionId);
    record.recentSubmissionIds = record.recentSubmissionIds.slice(-8);
    record.updatedAt = now;
    this.persistAgent(record);

    record.chain = record.chain.then(async () => {
      if (record.closed) {
        record.pendingTasks = Math.max(0, record.pendingTasks - 1);
        record.updatedAt = new Date().toISOString();
        submission.status = "cancelled";
        submission.updatedAt = record.updatedAt;
        submission.finishedAt = record.updatedAt;
        submission.error = "agent was closed before queued work started";
        this.persistAgent(record);
        this.persistSubmission(submission);
        return;
      }
      record.idleSince = undefined;
      record.idleRequested = undefined;
      record.status = "running";
      record.activeSubmissionId = submissionId;
      record.updatedAt = new Date().toISOString();
      const runBudgetMs = getSubagentRunBudgetMs(record.capabilityGrant);
      submission.status = "running";
      submission.runStartedAt = record.updatedAt;
      submission.budgetMs = runBudgetMs;
      submission.updatedAt = record.updatedAt;
      submission.lastProgressAt = record.updatedAt;
      submission.lastProgressSummary = buildInitialProgressSummary();
      this.persistAgent(record);
      this.persistSubmission(submission);

      const definition = getAgentDefinition(record.agentType);
      const rolePrompt = definition?.prompt ?? "";
      const perAgentSystem = [
        record.systemOverride ?? this.runtime.systemOverride,
        rolePrompt,
      ].filter(Boolean).join("\n\n");

      const allowed = getToolsForAgent(record.agentType, {
        inheritedTools: record.capabilityGrant.tools,
        blockDelegation: true,
      });
      const agentState: ToolRuntimeState = {
        cache: {
          readFile: new Map(),
          bash: new Map(),
        },
        guard: {
          duplicateToolCallLimit: Math.max(
            1,
            Math.trunc(Number(process.env.AGENTS_DUPLICATE_TOOL_CALL_LIMIT ?? 3) || 3)
          ),
          duplicateToolCallCount: new Map(),
        },
      };

      const subLogger = this.runtime.worldApiUrl
        ? new WorldLogger({
            apiUrl: this.runtime.worldApiUrl,
            processName: `${this.runtime.processName || "agents"}:${record.description}`,
            parentId: this.runtime.parentLoggerId,
          })
        : undefined;
      await subLogger?.start();

      try {
        const repoStageRoot =
          record.agentType === "worker" ? getAgentRepoStageRoot(record.agentWorkRoot) : undefined;
      const agentCwd = record.isolationMode === "private_workspace"
        ? (repoStageRoot ?? this.runtime.cwd)
        : this.runtime.cwd;
        let streamedChars = 0;
        let lastProgressPersistAt = Date.now();
        const progressPersistMs = getSubagentProgressPersistMs();
        const persistProgress = (summary: string, force = false) => {
          const normalized = String(summary || "").trim();
          if (!normalized) return;
          const nowMs = Date.now();
          if (!force && nowMs - lastProgressPersistAt < progressPersistMs) {
            return;
          }
          lastProgressPersistAt = nowMs;
          const now = new Date(nowMs).toISOString();
          submission.lastProgressAt = now;
          submission.lastProgressSummary = normalized;
          submission.updatedAt = now;
          record.updatedAt = now;
          this.persistAgent(record);
          this.persistSubmission(submission);
        };
        const result = await this.runtime.runner.run(taskPrompt, agentCwd, {
          depth: record.depth,
          history: record.history,
          allowedTools: allowed,
          systemOverride: perAgentSystem,
          ...(record.skillBundle?.length ? { requiredSkills: record.skillBundle } : {}),
          ...(record.modelOverride ? { modelOverride: record.modelOverride } : {}),
          state: agentState,
          toolContextMeta: {
            collabManager: this,
            currentAgentId: record.id,
            parentAgentId: record.parentAgentId,
            maxSubagentDepth: this.runtime.maxDepth,
            capabilityGrant: record.capabilityGrant,
            ...(record.capabilityProviderBundle?.length
              ? { capabilityProviderBundle: record.capabilityProviderBundle }
              : {}),
            agentWorkRoot: record.agentWorkRoot,
            ...(repoStageRoot ? { repoStageRoot } : {}),
            sharedWorkspaceRoot: this.runtime.cwd,
          },
          onTextDelta: (delta) => {
            streamedChars += String(delta || "").length;
            persistProgress(buildTextProgressSummary(streamedChars));
          },
          onToolCall: (toolCall) => {
            persistProgress(buildToolProgressSummary(toolCall), true);
            subLogger?.log(
              "event",
              `tool:${toolCall.name} status=${toolCall.status} args=${JSON.stringify(toolCall.args)}\n${toolCall.output}`
            );
          },
        });
        record.lastResult = result;
        record.lastError = undefined;
        record.completedTasks += 1;
        if (record.closed) {
          record.status = "closed";
        } else if (record.idleRequested === true) {
          record.status = "idle";
          record.idleSince = new Date().toISOString();
        } else {
          record.status = "completed";
        }
        record.activeSubmissionId = undefined;
        record.updatedAt = new Date().toISOString();
        record.idleRequested = undefined;
        submission.status = "completed";
        submission.result = result;
        submission.updatedAt = record.updatedAt;
        submission.finishedAt = record.updatedAt;
        writeAgentArtifactManifest(record.agentWorkRoot);
        writeWorkspaceHandoffManifest(record.agentWorkRoot, this.runtime.cwd);
        this.persistAgent(record);
        this.persistSubmission(submission);
        await subLogger?.log("stdout", result);
        await subLogger?.updateStatus("ok");
      } catch (error) {
        const msg = (error as Error).message || String(error);
        record.lastError = msg;
        record.status = record.closed ? "closed" : "failed";
        record.activeSubmissionId = undefined;
        record.updatedAt = new Date().toISOString();
        record.idleRequested = undefined;
        submission.status = "failed";
        submission.error = msg;
        submission.updatedAt = record.updatedAt;
        submission.finishedAt = record.updatedAt;
        writeAgentArtifactManifest(record.agentWorkRoot);
        writeWorkspaceHandoffManifest(record.agentWorkRoot, this.runtime.cwd);
        this.persistAgent(record);
        this.persistSubmission(submission);
        await subLogger?.log("stderr", msg);
        await subLogger?.updateStatus("error");
      } finally {
        record.pendingTasks = Math.max(0, record.pendingTasks - 1);
        record.updatedAt = new Date().toISOString();
        this.persistAgent(record);
        this.persistSubmission(submission);
      }
    });

    if (record.status !== "running") {
      record.status = "queued";
      this.persistAgent(record);
    }
    return { submissionId };
  }

  close(id: string) {
    const record = this.agents.get(id);
    if (!record) throw new Error(`agent not found: ${id}`);
    record.closed = true;
    record.idleSince = undefined;
    record.idleRequested = undefined;
    this.stopAutonomyLoop(id);
    record.status = isFinal(record.status) ? record.status : "closed";
    record.updatedAt = new Date().toISOString();
    this.persistAgent(record);
    return record.status;
  }

  resume(id: string): AgentStatusSummary {
    const record = this.agents.get(id);
    if (!record) throw new Error(`agent not found: ${id}`);
    record.closed = false;
    record.idleSince = undefined;
    record.idleRequested = undefined;
    this.ensureAutonomyLoop(record);
    if (record.pendingTasks > 0) {
      record.status = "queued";
    } else if (record.status === "closed") {
      record.status = record.lastError ? "failed" : "completed";
    }
    record.updatedAt = new Date().toISOString();
    this.persistAgent(record);
    return this.status(id);
  }

  markIdle(id: string): AgentStatusSummary {
    const record = this.agents.get(id) ?? this.loadPersistedAgent(id);
    if (!record) throw new Error(`agent not found: ${id}`);
    if (record.closed) throw new Error(`agent is closed: ${id}`);
    if (record.pendingTasks > 0 || record.activeSubmissionId) {
      record.idleRequested = true;
      record.updatedAt = new Date().toISOString();
      this.persistAgent(record);
      return this.status(id);
    }
    if (record.status !== "idle") {
      record.status = "idle";
      record.idleSince = new Date().toISOString();
      record.idleRequested = undefined;
      record.updatedAt = record.idleSince;
      this.persistAgent(record);
    }
    return this.status(id);
  }

  status(id: string): AgentStatusSummary {
    const liveRecord = this.agents.get(id);
    const record = liveRecord ?? this.loadPersistedAgent(id);
    if (!record) throw new Error(`agent not found: ${id}`);
    const claimedTask = record.claimedTaskId
      ? this.tryGetTask(record.claimedTaskId)
      : null;
    const unreadMailboxCount = this.runtime.mailbox.unreadCount(record.id);
    const pendingProtocolCount = this.runtime.protocol.pendingCount(record.id);
    const recentArtifacts = collectAgentArtifacts(record.agentWorkRoot);
    const handoffFiles = collectWorkspaceHandoffFiles(record.agentWorkRoot, this.runtime.cwd);
    return {
      id: record.id,
      description: record.description,
      agent_type: record.agentType,
      execution_mode: record.executionMode,
      isolation_mode: record.isolationMode,
      skill_bundle: record.skillBundle,
      capability_provider_bundle: record.capabilityProviderBundle,
      ...(record.modelOverride ? { model: record.modelOverride } : {}),
      status: record.status,
      status_source: liveRecord ? "live" : "persisted",
      agent_work_root: record.agentWorkRoot,
      autonomous: record.autonomous,
      claimed_task_id: record.claimedTaskId,
      claimed_task_subject: claimedTask?.subject,
      claimed_task_lane: claimedTask?.workspaceLane,
      idle_since: record.idleSince,
      artifact_count: recentArtifacts.length,
      recent_artifacts: recentArtifacts,
      handoff_file_count: handoffFiles.length,
      depth: record.depth,
      parent_agent_id: record.parentAgentId,
      pending_tasks: record.pendingTasks,
      completed_tasks: record.completedTasks,
      active_submission_id: record.activeSubmissionId,
      last_submission_id: record.lastSubmissionId,
      updated_at: record.updatedAt,
      unread_mailbox_count: unreadMailboxCount,
      pending_protocol_count: pendingProtocolCount,
      recent_submissions: record.recentSubmissionIds
        .map((submissionId) => this.submissionStatus(submissionId))
        .filter((item): item is SubmissionStatusSummary => item !== null),
      result_preview: preview(record.lastResult),
      error: record.lastError,
    };
  }

  list(): AgentStatusSummary[] {
    const ids = new Set<string>([
      ...Array.from(this.agents.keys()),
      ...this.runtime.store.listAgents().map((record) => record.id),
    ]);
    return Array.from(ids).map((id) => this.status(id));
  }

  get(id: string): AgentRecord {
    const record = this.agents.get(id) ?? this.loadPersistedAgent(id);
    if (!record) throw new Error(`agent not found: ${id}`);
    return record;
  }

  getTask(taskId: string) {
    return this.tryGetTask(taskId);
  }

  subscribeStatus(id: string, listener: () => void): () => void {
    this.get(id);
    const current = this.statusListeners.get(id) ?? new Set<() => void>();
    current.add(listener);
    this.statusListeners.set(id, current);
    return () => {
      const listeners = this.statusListeners.get(id);
      if (!listeners) return;
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.statusListeners.delete(id);
      }
    };
  }

  submissionStatus(submissionId: string): SubmissionStatusSummary | null {
    const liveSubmission = this.submissions.get(submissionId);
    const submission = liveSubmission ?? this.loadPersistedSubmission(submissionId);
    if (!submission) return null;
    const nowMs = Date.now();
    const runStartedMs = submission.runStartedAt
      ? new Date(submission.runStartedAt).getTime()
      : Number.NaN;
    const finishedMs = submission.finishedAt ? new Date(submission.finishedAt).getTime() : Number.NaN;
    const endMs = Number.isFinite(finishedMs) ? finishedMs : nowMs;
    const runElapsedMs =
      Number.isFinite(runStartedMs) && endMs >= runStartedMs
        ? Math.max(0, Math.trunc(endMs - runStartedMs))
        : undefined;
    const budgetMs =
      typeof submission.budgetMs === "number" && Number.isFinite(submission.budgetMs)
        ? Math.max(0, Math.trunc(submission.budgetMs))
        : undefined;
    const overBudgetMs =
      typeof runElapsedMs === "number" && typeof budgetMs === "number" && runElapsedMs > budgetMs
        ? Math.max(0, runElapsedMs - budgetMs)
        : undefined;
    const budgetExceededAt =
      typeof budgetMs === "number" && Number.isFinite(runStartedMs)
        ? new Date(runStartedMs + budgetMs).toISOString()
        : undefined;
    const lastProgressMs = submission.lastProgressAt
      ? new Date(submission.lastProgressAt).getTime()
      : Number.NaN;
    const lastProgressAgeMs =
      Number.isFinite(lastProgressMs) && nowMs >= lastProgressMs
        ? Math.max(0, Math.trunc(nowMs - lastProgressMs))
        : undefined;
    return {
      id: submission.id,
      agent_id: submission.agentId,
      status: submission.status,
      status_source: liveSubmission ? "live" : "persisted",
      created_at: submission.createdAt,
      updated_at: submission.updatedAt,
      finished_at: submission.finishedAt,
      prompt_preview: preview(submission.prompt, 240),
      result_preview: preview(submission.result),
      error: submission.error,
      run_started_at: submission.runStartedAt,
      run_elapsed_ms: runElapsedMs,
      budget_ms: budgetMs,
      budget_exceeded_at: budgetExceededAt,
      over_budget_ms: overBudgetMs,
      last_progress_at: submission.lastProgressAt,
      last_progress_age_ms: lastProgressAgeMs,
      last_progress_summary: submission.lastProgressSummary,
    };
  }

  listSubmissionsForAgents(ids: string[]): SubmissionStatusSummary[] {
    const allowed = new Set(ids);
    const live = Array.from(this.submissions.values());
    const persisted = this.runtime.store.listSubmissions()
      .filter((submission) => !this.submissions.has(submission.id))
      .map((submission) => this.toLiveSubmissionRecord(submission));
    return [...live, ...persisted]
      .filter((submission) => allowed.has(submission.agentId))
      .map((submission) => this.submissionStatus(submission.id))
      .filter((item): item is SubmissionStatusSummary => item !== null);
  }

  sendMailboxMessage(input: {
    toAgentId: string;
    body: string;
    fromAgentId?: string;
    subject?: string;
  }): PersistedMailboxMessage {
    const recipient = this.get(input.toAgentId);
    const body = String(input.body || "").trim();
    if (!body) throw new Error("mailbox body 不能为空。");
    const message: PersistedMailboxMessage = {
      id: randomUUID(),
      toAgentId: recipient.id,
      ...(input.fromAgentId ? { fromAgentId: input.fromAgentId } : {}),
      ...(input.subject ? { subject: input.subject } : {}),
      body,
      createdAt: new Date().toISOString(),
    };
    this.runtime.mailbox.saveMessage(message);
    return message;
  }

  readMailbox(
    agentId: string,
    options?: {
      includeRead?: boolean;
      limit?: number;
      markAsRead?: boolean;
    }
  ): PersistedMailboxMessage[] {
    this.get(agentId);
    const messages = this.runtime.mailbox.listMessagesForAgent(agentId, {
      includeRead: options?.includeRead,
      limit: options?.limit,
    });
    if (options?.markAsRead !== true) return messages;
    const unreadIds = messages.filter((message) => !message.readAt).map((message) => message.id);
    if (unreadIds.length === 0) return messages;
    const updated = this.runtime.mailbox.markRead(unreadIds, new Date().toISOString());
    const updatedById = new Map(updated.map((message) => [message.id, message] as const));
    return messages.map((message) => updatedById.get(message.id) ?? message);
  }

  unreadMailboxCount(agentId: string): number {
    this.get(agentId);
    return this.runtime.mailbox.unreadCount(agentId);
  }

  requestProtocol(input: {
    toAgentId: string;
    action: string;
    input: string;
    fromAgentId?: string;
  }): PersistedProtocolRequest {
    const recipient = this.get(input.toAgentId);
    const action = String(input.action || "").trim();
    const payload = String(input.input || "").trim();
    if (!action) throw new Error("protocol_request 缺少 action。");
    if (!payload) throw new Error("protocol_request 缺少 input。");
    const now = new Date().toISOString();
    const request: PersistedProtocolRequest = {
      id: randomUUID(),
      ...(input.fromAgentId ? { fromAgentId: input.fromAgentId } : {}),
      toAgentId: recipient.id,
      action,
      input: payload,
      createdAt: now,
      updatedAt: now,
      status: "pending",
    };
    this.runtime.protocol.saveRequest(request);
    return request;
  }

  readProtocolInbox(
    agentId: string,
    options?: {
      includeResponded?: boolean;
      limit?: number;
    }
  ): PersistedProtocolRequest[] {
    this.get(agentId);
    return this.runtime.protocol.listRequestsForAgent(agentId, options);
  }

  protocolPendingCount(agentId: string): number {
    this.get(agentId);
    return this.runtime.protocol.pendingCount(agentId);
  }

  getProtocolRequest(id: string): PersistedProtocolRequest {
    const request = this.runtime.protocol.loadRequest(id);
    if (!request) throw new Error(`protocol request not found: ${id}`);
    return request;
  }

  respondProtocol(input: {
    requestId: string;
    output: string;
    status: PersistedProtocolResponseStatus;
    responderAgentId?: string;
  }): PersistedProtocolRequest {
    const request = this.getProtocolRequest(input.requestId);
    if (request.status === "responded") {
      throw new Error(`protocol request already responded: ${input.requestId}`);
    }
    const output = String(input.output || "").trim();
    if (!output) throw new Error("protocol_respond 缺少 output。");
    const now = new Date().toISOString();
    const next: PersistedProtocolRequest = {
      ...request,
      updatedAt: now,
      status: "responded",
      response: {
        ...(input.responderAgentId ? { responderAgentId: input.responderAgentId } : {}),
        status: input.status,
        output,
        respondedAt: now,
      },
    };
    this.runtime.protocol.saveRequest(next);
    return next;
  }

  listWorkspaceHandoff(agentId: string): AgentWorkspaceHandoffFile[] {
    const record = this.get(agentId);
    if (record.agentType !== "worker") {
      throw new Error("workspace handoff 仅适用于 worker agent。");
    }
    return collectWorkspaceHandoffFiles(record.agentWorkRoot, this.runtime.cwd);
  }

  importAgentWorkspace(input: {
    agentId: string;
    mode: "dry_run" | "apply";
    conflictPolicy?: AgentWorkspaceImportConflictPolicy;
  }) {
    const record = this.get(input.agentId);
    if (record.agentType !== "worker") {
      throw new Error("agent_workspace_import 仅允许导入 worker agent 的 staged repo 文件。");
    }
    const files = this.listWorkspaceHandoff(input.agentId);
    const conflictPolicy = input.conflictPolicy ?? "fail";
    const claimedTask = record.claimedTaskId
      ? this.tryGetTask(record.claimedTaskId)
      : null;
    const conflictFiles = files.filter((file) => file.import_decision === "conflict");
    if (input.mode === "apply" && conflictFiles.length > 0 && conflictPolicy !== "overwrite") {
      throw new Error(
        `agent_workspace_import 检测到 ${conflictFiles.length} 个冲突文件；请先 dry_run 检查，或显式设置 conflict_policy=\"overwrite\"。`
      );
    }
    let copiedCount = 0;
    let skippedCount = 0;
    if (input.mode === "apply") {
      for (const file of files) {
        if (file.import_decision === "unchanged") {
          skippedCount += 1;
          continue;
        }
        fs.mkdirSync(path.dirname(file.target_path), { recursive: true });
        fs.copyFileSync(file.source_path, file.target_path);
        copiedCount += 1;
      }
    }
    const summary = summarizeWorkspaceImport(
      files,
      copiedCount,
      input.mode === "apply" ? skippedCount : files.filter((file) => file.import_decision === "unchanged").length
    );
    return {
      agent_id: record.id,
      mode: input.mode,
      conflict_policy: conflictPolicy,
      source_root: getAgentRepoStageRoot(record.agentWorkRoot),
      target_root: this.runtime.cwd,
      audit: {
        agent_id: record.id,
        agent_type: record.agentType,
        agent_work_root: record.agentWorkRoot,
        workspace_lane: getAgentWorkspaceLane(record),
        ...(record.claimedTaskId ? { claimed_task_id: record.claimedTaskId } : {}),
        ...(claimedTask?.subject ? { claimed_task_subject: claimedTask.subject } : {}),
        ...(claimedTask?.owner ? { claimed_task_owner: claimedTask.owner } : {}),
        ...(claimedTask?.workspaceLane ? { claimed_task_lane: claimedTask.workspaceLane } : {}),
      },
      summary,
      files,
    };
  }

  describeForPrompt(currentAgentId?: string) {
    const agents = this.list();
    if (agents.length === 0) return "";
    const lines = agents.slice(0, 12).map((record) => {
      const parts = [
        `id=${record.id}`,
        `role=${record.agent_type}`,
        `status=${record.status}`,
        `work_root=${record.agent_work_root}`,
        `depth=${record.depth}`,
        `pending=${record.pending_tasks}`,
        `completed=${record.completed_tasks}`,
        `unread_mail=${record.unread_mailbox_count}`,
        `pending_protocol=${record.pending_protocol_count}`,
      ];
      if (record.parent_agent_id) parts.push(`parent=${record.parent_agent_id}`);
      if (record.claimed_task_id) parts.push(`claimed_task=${record.claimed_task_id}`);
      if (record.claimed_task_lane) parts.push(`task_lane=${record.claimed_task_lane}`);
      if (record.model) parts.push(`model=${record.model}`);
      if (record.id === currentAgentId) parts.push("current=true");
      return `- ${parts.join(" ")} desc=${JSON.stringify(record.description)}`;
    });
    return [
      "<agents_team_state>",
      ...(currentAgentId ? [`current_agent_id: ${currentAgentId}`] : []),
      `agent_count: ${agents.length}`,
      "agents:",
      ...lines,
      "</agents_team_state>",
    ].join("\n");
  }

  private persistAgent(record: AgentRecord): void {
    this.runtime.store.saveAgent(this.toPersistedAgentRecord(record));
    this.notifyStatusListeners(record.id);
  }

  private notifyStatusListeners(id: string): void {
    const listeners = this.statusListeners.get(id);
    if (!listeners || listeners.size === 0) return;
    for (const listener of Array.from(listeners)) {
      try {
        listener();
      } catch {
        continue;
      }
    }
  }

  private bindClaimedTask(record: AgentRecord, taskId?: string): void {
    if (!taskId) return;
    const workspaceLane = getAgentWorkspaceLane(record);
    const task = this.runtime.tasks.claim(taskId, {
      owner: record.id,
      workspaceLane,
    });
    record.claimedTaskId = task.id;
  }

  private ensureAutonomyLoop(record: AgentRecord): void {
    if (!record.autonomous || this.autonomyTimers.has(record.id)) return;
    const pollMs = readEnvMs("AGENTS_AUTONOMOUS_POLL_MS", 5000);
    const idleTimeoutMs = readEnvMs("AGENTS_AUTONOMOUS_IDLE_TIMEOUT_MS", 60000);
    const timer = setInterval(() => {
      try {
        const current = this.agents.get(record.id) ?? this.loadPersistedAgent(record.id);
        if (!current || current.closed) {
          this.stopAutonomyLoop(record.id);
          return;
        }
        if (current.pendingTasks > 0 || current.activeSubmissionId) {
          return;
        }
        const workspaceLane = getAgentWorkspaceLane(current);
        const claimed = this.runtime.tasks.claimNextAvailable({
          owner: current.id,
          workspaceLane,
        });
        if (!claimed) {
          if (current.status !== "idle") {
            current.status = "idle";
            current.idleSince = new Date().toISOString();
            current.updatedAt = current.idleSince;
            this.persistAgent(current);
            return;
          }
          if (!current.idleSince || idleTimeoutMs <= 0) {
            return;
          }
          const idleForMs = Date.now() - new Date(current.idleSince).getTime();
          if (Number.isFinite(idleForMs) && idleForMs >= idleTimeoutMs) {
            this.close(current.id);
          }
          return;
        }
        current.idleSince = undefined;
        current.status = "queued";
        current.claimedTaskId = claimed.id;
        this.persistAgent(current);
        this.enqueue(
          current.id,
          [
            "<auto-claimed-task>",
            `task_id: ${claimed.id}`,
            `subject: ${claimed.subject}`,
            claimed.description ? `description: ${claimed.description}` : "",
            `workspace_lane: ${claimed.workspaceLane}`,
            "</auto-claimed-task>",
            "你已自动认领该任务。请完成它；完成后同步更新任务状态。",
          ]
            .filter(Boolean)
            .join("\n")
        );
      } catch {
        // Keep polling; task board may change underneath us.
      }
    }, pollMs);
    this.autonomyTimers.set(record.id, timer);
  }

  private stopAutonomyLoop(agentId: string): void {
    const timer = this.autonomyTimers.get(agentId);
    if (!timer) return;
    clearInterval(timer);
    this.autonomyTimers.delete(agentId);
  }

  private persistSubmission(record: SubmissionRecord): void {
    this.runtime.store.saveSubmission(this.toPersistedSubmissionRecord(record));
  }

  private tryGetTask(taskId: string) {
    try {
      return this.runtime.tasks.get(taskId);
    } catch {
      return null;
    }
  }

  private loadPersistedAgent(id: string): AgentRecord | null {
    const persisted = this.runtime.store.loadAgent(id);
    if (!persisted) return null;
    return this.toLiveAgentRecord(persisted);
  }

  private loadPersistedSubmission(id: string): SubmissionRecord | null {
    const persisted = this.runtime.store.loadSubmission(id);
    if (!persisted) return null;
    return this.toLiveSubmissionRecord(persisted);
  }

  private toPersistedAgentRecord(record: AgentRecord): PersistedAgentRecord {
    return {
      id: record.id,
      description: record.description,
      agentType: record.agentType,
      executionMode: record.executionMode,
      isolationMode: record.isolationMode,
      ...(record.skillBundle?.length ? { skillBundle: [...record.skillBundle] } : {}),
      ...(record.capabilityProviderBundle?.length
        ? { capabilityProviderBundle: [...record.capabilityProviderBundle] }
        : {}),
      capabilityGrant: record.capabilityGrant,
      ...(record.modelOverride ? { modelOverride: record.modelOverride } : {}),
      agentWorkRoot: record.agentWorkRoot,
      autonomous: record.autonomous,
      ...(record.claimedTaskId ? { claimedTaskId: record.claimedTaskId } : {}),
      ...(record.idleSince ? { idleSince: record.idleSince } : {}),
      ...(record.idleRequested === true ? { idleRequested: true } : {}),
      depth: record.depth,
      ...(record.parentAgentId ? { parentAgentId: record.parentAgentId } : {}),
      status: record.status,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      pendingTasks: record.pendingTasks,
      completedTasks: record.completedTasks,
      ...(record.lastSubmissionId ? { lastSubmissionId: record.lastSubmissionId } : {}),
      ...(record.activeSubmissionId ? { activeSubmissionId: record.activeSubmissionId } : {}),
      recentSubmissionIds: [...record.recentSubmissionIds],
      ...(record.lastResult ? { lastResult: record.lastResult } : {}),
      ...(record.lastError ? { lastError: record.lastError } : {}),
      closed: record.closed,
    };
  }

  private toPersistedSubmissionRecord(record: SubmissionRecord): PersistedSubmissionRecord {
    return {
      id: record.id,
      agentId: record.agentId,
      prompt: record.prompt,
      status: record.status,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      ...(record.finishedAt ? { finishedAt: record.finishedAt } : {}),
      ...(record.result ? { result: record.result } : {}),
      ...(record.error ? { error: record.error } : {}),
      ...(record.runStartedAt ? { runStartedAt: record.runStartedAt } : {}),
      ...(typeof record.budgetMs === "number" ? { budgetMs: record.budgetMs } : {}),
      ...(record.lastProgressAt ? { lastProgressAt: record.lastProgressAt } : {}),
      ...(record.lastProgressSummary ? { lastProgressSummary: record.lastProgressSummary } : {}),
    };
  }

  private toLiveAgentRecord(record: PersistedAgentRecord): AgentRecord {
    return {
      id: record.id,
      description: record.description,
      agentType: record.agentType as AgentType,
      executionMode: record.executionMode ?? "direct",
      isolationMode: record.isolationMode ?? "shared_workspace",
      ...(record.skillBundle?.length ? { skillBundle: [...record.skillBundle] } : {}),
      ...(record.capabilityProviderBundle?.length
        ? { capabilityProviderBundle: [...record.capabilityProviderBundle] }
        : {}),
      capabilityGrant: record.capabilityGrant ?? this.runtime.baseCapabilityGrant,
      ...(record.modelOverride ? { modelOverride: record.modelOverride } : {}),
      agentWorkRoot: record.agentWorkRoot ?? allocateAgentWorkRoot(this.runtime.cwd, record.id),
      autonomous: record.autonomous === true,
      ...(record.claimedTaskId ? { claimedTaskId: record.claimedTaskId } : {}),
      ...(record.idleSince ? { idleSince: record.idleSince } : {}),
      ...(record.idleRequested === true ? { idleRequested: true } : {}),
      depth: record.depth,
      ...(record.parentAgentId ? { parentAgentId: record.parentAgentId } : {}),
      history: [],
      status: record.status,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      pendingTasks: record.pendingTasks,
      completedTasks: record.completedTasks,
      ...(record.lastSubmissionId ? { lastSubmissionId: record.lastSubmissionId } : {}),
      ...(record.activeSubmissionId ? { activeSubmissionId: record.activeSubmissionId } : {}),
      recentSubmissionIds: [...record.recentSubmissionIds],
      ...(record.lastResult ? { lastResult: record.lastResult } : {}),
      ...(record.lastError ? { lastError: record.lastError } : {}),
      closed: record.closed,
      chain: Promise.resolve(),
      getDrainPromise: () => Promise.resolve(),
    };
  }

  private toLiveSubmissionRecord(record: PersistedSubmissionRecord): SubmissionRecord {
    return {
      id: record.id,
      agentId: record.agentId,
      prompt: record.prompt,
      status: record.status,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      ...(record.finishedAt ? { finishedAt: record.finishedAt } : {}),
      ...(record.result ? { result: record.result } : {}),
      ...(record.error ? { error: record.error } : {}),
      ...(record.runStartedAt ? { runStartedAt: record.runStartedAt } : {}),
      ...(typeof record.budgetMs === "number" ? { budgetMs: record.budgetMs } : {}),
      ...(record.lastProgressAt ? { lastProgressAt: record.lastProgressAt } : {}),
      ...(record.lastProgressSummary ? { lastProgressSummary: record.lastProgressSummary } : {}),
    };
  }
}
