import path from "node:path";

import type {
  AgentConfig,
  CapabilityGrant,
  ContextDiagnostics,
  ContextSourceDiagnostic,
  RunEnvelope,
} from "../types/index.js";
import { resolveContextSourceFragments } from "./context-source-providers.js";
import { buildMemoryPromptFragment, resolveMemoryRoot } from "./memory/layered.js";
import type { ToolCallTrace, RunHookContext } from "./hooks/types.js";
import { resolveWorkspaceContext } from "./workspace-context/assembler.js";
import { buildSystemSnapshot } from "./system-snapshot.js";

export type ResolvedAgentRunContext = {
  workspaceContext: import("./workspace-context/types.js").WorkspaceContext;
  memoryRoot: string;
  runtimeMeta: Record<string, unknown>;
  hookContext: RunHookContext;
  contextDiagnostics: ContextDiagnostics;
  contextPromptFragment: string;
};

function truncate(value: string, maxChars: number): { text: string; truncated: boolean } {
  if (value.length <= maxChars) return { text: value, truncated: false };
  if (maxChars <= 1) return { text: value.slice(0, maxChars), truncated: true };
  return { text: `${value.slice(0, maxChars - 1).trimEnd()}…`, truncated: true };
}
function applyContextBudgets(sources: Array<{
  id: string;
  kind: ContextSourceDiagnostic["kind"];
  summary: string;
  content: string;
  budgetChars: number;
}>): {
  contextPromptFragment: string;
  diagnostics: ContextDiagnostics;
} {
  const diagnostics: ContextSourceDiagnostic[] = [];
  const rendered: string[] = [];
  for (const source of sources) {
    const { text, truncated } = truncate(source.content.trim(), source.budgetChars);
    if (!text.trim()) continue;
    rendered.push(text.trim());
    diagnostics.push({
      id: source.id,
      kind: source.kind,
      summary: source.summary,
      chars: text.length,
      budgetChars: source.budgetChars,
      truncated,
    });
  }
  const totalChars = diagnostics.reduce((sum, item) => sum + item.chars, 0);
  const totalBudgetChars = diagnostics.reduce((sum, item) => sum + item.budgetChars, 0);
  return {
    contextPromptFragment: rendered.join("\n\n").trim(),
    diagnostics: {
      totalChars,
      totalBudgetChars,
      sources: diagnostics,
    },
  };
}

export async function resolveAgentRunContext(params: {
  config: AgentConfig;
  cwd: string;
  prompt: string;
  requiredSkills: string[];
  capabilityGrant: CapabilityGrant;
  runEnvelope: RunEnvelope;
  localResourcePaths: string[];
  toolCalls: ToolCallTrace[];
  toolContextMeta?: Record<string, unknown>;
  sessionId?: string;
  currentModel: string;
}): Promise<ResolvedAgentRunContext> {
  const workspaceContext = await resolveWorkspaceContext({
    workspaceRoot: params.config.workspaceRoot,
    cwd: params.cwd,
    resourceRoots: params.localResourcePaths,
  });
  const memoryRoot = resolveMemoryRoot(
    params.toolContextMeta,
    path.join(params.cwd, params.config.memoryDir),
  );
  const memoryPromptFragment = buildMemoryPromptFragment({
    memoryRoot,
    prompt: params.prompt,
    ...(params.sessionId ? { sessionId: params.sessionId } : {}),
  });
  const systemSnapshot = buildSystemSnapshot(params.cwd);
  const { contextPromptFragment, diagnostics } = applyContextBudgets(
    resolveContextSourceFragments({
      workspaceContext,
      memoryPromptFragment,
      toolContextMeta: {
        ...(params.toolContextMeta ?? {}),
        systemSnapshot,
      },
      localResourcePaths: params.localResourcePaths,
    }),
  );
  const runtimeMeta: Record<string, unknown> = params.toolContextMeta ?? {};
  runtimeMeta.capabilityGrant = params.capabilityGrant;
  runtimeMeta.runEnvelope = params.runEnvelope;
  runtimeMeta.currentModel = params.currentModel;
  runtimeMeta.currentRequiredSkills = params.requiredSkills;
  runtimeMeta.workspaceContextSummary = workspaceContext.summary;
  runtimeMeta.workspaceContextFiles = workspaceContext.files.map((file) => file.path);
  runtimeMeta.workspaceEvidenceBundles = workspaceContext.evidenceBundles.map((bundle) => ({
    id: bundle.id,
    kind: bundle.kind,
    source: bundle.source,
    summary: bundle.summary,
  }));
  runtimeMeta.memoryRoot = memoryRoot;
  runtimeMeta.systemSnapshot = systemSnapshot;
  runtimeMeta.contextDiagnostics = diagnostics;
  const hookContext: RunHookContext = {
    runId: params.runEnvelope.runId,
    cwd: params.cwd,
    workspaceRoot: workspaceContext.rootDir,
    prompt: params.prompt,
    ...(params.sessionId ? { sessionId: params.sessionId } : {}),
    requiredSkills: params.requiredSkills,
    modelOverride: params.currentModel,
    workspaceContext,
    runtimeMeta,
    toolCalls: params.toolCalls,
  };
  return {
    workspaceContext,
    memoryRoot,
    runtimeMeta,
    hookContext,
    contextDiagnostics: diagnostics,
    contextPromptFragment,
  };
}
