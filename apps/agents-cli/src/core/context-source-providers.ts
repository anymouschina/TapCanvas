import type { ContextSourceDiagnostic } from "../types/index.js";

import type { WorkspaceContext } from "./workspace-context/types.js";

export type ContextSourceFragment = {
  id: string;
  kind: ContextSourceDiagnostic["kind"];
  summary: string;
  content: string;
  budgetChars: number;
};

export type ContextSourceProviderInput = {
  workspaceContext: WorkspaceContext;
  memoryPromptFragment: string;
  toolContextMeta?: Record<string, unknown>;
  localResourcePaths: string[];
};

type ContextSourceProvider = {
  id: string;
  collect: (input: ContextSourceProviderInput) => ContextSourceFragment[];
};

const CONTEXT_BUDGETS: Record<ContextSourceDiagnostic["kind"], number> = {
  persona: 6_000,
  workspace_rules: 8_000,
  system_snapshot: 2_500,
  memory: 6_000,
  runtime_diagnostics: 2_000,
  generation_contract: 2_000,
  canvas_capability: 2_000,
  request_scope: 2_500,
};

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? "");
  }
}

function compactList(values: string[], max = 12): string[] {
  return values
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, max);
}

const personaContextProvider: ContextSourceProvider = {
  id: "persona",
  collect(input) {
    const personaBundles = input.workspaceContext.evidenceBundles.filter((bundle) => bundle.kind === "persona");
    if (personaBundles.length <= 0) return [];
    return [
      {
        id: "persona",
        kind: "persona",
        summary: `${personaBundles.length} persona bundle(s)`,
        content: [
          "## Persona Context",
          ...personaBundles.map((bundle) => `### ${bundle.source}\n\n${bundle.content}`),
        ].join("\n\n"),
        budgetChars: CONTEXT_BUDGETS.persona,
      },
    ];
  },
};

const workspaceRulesContextProvider: ContextSourceProvider = {
  id: "workspace_rules",
  collect(input) {
    const workspaceBundles = input.workspaceContext.evidenceBundles.filter((bundle) => bundle.kind !== "persona");
    if (workspaceBundles.length <= 0) return [];
    return [
      {
        id: "workspace_rules",
        kind: "workspace_rules",
        summary: `${workspaceBundles.length} workspace context bundle(s)`,
        content: [
          "## Workspace Context",
          `workspaceRoot: ${input.workspaceContext.rootDir}`,
          ...workspaceBundles.map((bundle) => `### ${bundle.source}\n\n${bundle.content}`),
        ].join("\n\n"),
        budgetChars: CONTEXT_BUDGETS.workspace_rules,
      },
    ];
  },
};

const memoryContextProvider: ContextSourceProvider = {
  id: "memory",
  collect(input) {
    if (!input.memoryPromptFragment.trim()) return [];
    return [
      {
        id: "memory",
        kind: "memory",
        summary: "persisted memory excerpt",
        content: input.memoryPromptFragment,
        budgetChars: CONTEXT_BUDGETS.memory,
      },
    ];
  },
};

const systemSnapshotContextProvider: ContextSourceProvider = {
  id: "system_snapshot",
  collect(input) {
    const snapshot =
      input.toolContextMeta?.systemSnapshot &&
      typeof input.toolContextMeta.systemSnapshot === "object" &&
      !Array.isArray(input.toolContextMeta.systemSnapshot)
        ? input.toolContextMeta.systemSnapshot as Record<string, unknown>
        : null;
    if (!snapshot) return [];
    const lines = [
      "## System Snapshot",
      typeof snapshot.currentDate === "string" ? `currentDate: ${snapshot.currentDate}` : "",
      typeof snapshot.gitBranch === "string" && snapshot.gitBranch.trim()
        ? `gitBranch: ${snapshot.gitBranch.trim()}`
        : "",
      typeof snapshot.gitStatus === "string" && snapshot.gitStatus.trim()
        ? `gitStatus:\n${snapshot.gitStatus.trim()}`
        : "",
      Array.isArray(snapshot.recentCommits) && snapshot.recentCommits.length > 0
        ? `recentCommits:\n${snapshot.recentCommits.map((item) => `- ${String(item || "").trim()}`).join("\n")}`
        : "",
    ].filter(Boolean);
    if (lines.length <= 1) return [];
    return [
      {
        id: "system_snapshot",
        kind: "system_snapshot",
        summary: "system runtime snapshot",
        content: lines.join("\n"),
        budgetChars: CONTEXT_BUDGETS.system_snapshot,
      },
    ];
  },
};

const runtimeDiagnosticsContextProvider: ContextSourceProvider = {
  id: "runtime_diagnostics",
  collect(input) {
    if (!input.toolContextMeta?.diagnosticContext) return [];
    return [
      {
        id: "runtime_diagnostics",
        kind: "runtime_diagnostics",
        summary: "runtime diagnostic context",
        content: `## Runtime Diagnostics\n${stringifyJson(input.toolContextMeta.diagnosticContext)}`,
        budgetChars: CONTEXT_BUDGETS.runtime_diagnostics,
      },
    ];
  },
};

const generationContractContextProvider: ContextSourceProvider = {
  id: "generation_contract",
  collect(input) {
    if (!input.toolContextMeta?.generationContract) return [];
    return [
      {
        id: "generation_contract",
        kind: "generation_contract",
        summary: "generation contract",
        content: `## Generation Contract\n${stringifyJson(input.toolContextMeta.generationContract)}`,
        budgetChars: CONTEXT_BUDGETS.generation_contract,
      },
    ];
  },
};

const canvasCapabilityContextProvider: ContextSourceProvider = {
  id: "canvas_capability",
  collect(input) {
    if (!input.toolContextMeta?.canvasCapabilityManifest) return [];
    const manifest = input.toolContextMeta.canvasCapabilityManifest as Record<string, unknown>;
    return [
      {
        id: "canvas_capability",
        kind: "canvas_capability",
        summary: "canvas capability manifest summary",
        content: [
          "## Canvas Capability Context",
          `version: ${typeof manifest.version === "string" ? manifest.version : "unknown"}`,
          `summary: ${typeof manifest.summary === "string" ? manifest.summary : "n/a"}`,
          `localCanvasTools: ${Array.isArray(manifest.localCanvasTools) ? manifest.localCanvasTools.length : 0}`,
          `remoteTools: ${Array.isArray(manifest.remoteTools) ? manifest.remoteTools.length : 0}`,
          `nodeKinds: ${manifest.nodeSpecs && typeof manifest.nodeSpecs === "object" && !Array.isArray(manifest.nodeSpecs) ? Object.keys(manifest.nodeSpecs as Record<string, unknown>).join(", ") : "none"}`,
        ].join("\n"),
        budgetChars: CONTEXT_BUDGETS.canvas_capability,
      },
    ];
  },
};

const requestScopeContextProvider: ContextSourceProvider = {
  id: "request_scope",
  collect(input) {
    const requestScopeLines = [
      compactList(input.localResourcePaths).length > 0
        ? `localResourcePaths: ${compactList(input.localResourcePaths).join(", ")}`
        : "",
      Array.isArray(input.toolContextMeta?.referenceImageSlots)
        ? `referenceImageSlots: ${Math.min(input.toolContextMeta.referenceImageSlots.length, 16)}`
        : "",
      Array.isArray(input.toolContextMeta?.sessionAssetInputs)
        ? `assetInputs: ${Math.min(input.toolContextMeta.sessionAssetInputs.length, 24)}`
        : "",
    ].filter(Boolean);
    if (requestScopeLines.length <= 0) return [];
    return [
      {
        id: "request_scope",
        kind: "request_scope",
        summary: "request scope facts",
        content: `## Request Scope\n${requestScopeLines.join("\n")}`,
        budgetChars: CONTEXT_BUDGETS.request_scope,
      },
    ];
  },
};

const DEFAULT_CONTEXT_SOURCE_PROVIDERS: ContextSourceProvider[] = [
  personaContextProvider,
  workspaceRulesContextProvider,
  systemSnapshotContextProvider,
  memoryContextProvider,
  runtimeDiagnosticsContextProvider,
  generationContractContextProvider,
  canvasCapabilityContextProvider,
  requestScopeContextProvider,
];

export function resolveContextSourceFragments(input: ContextSourceProviderInput): ContextSourceFragment[] {
  return DEFAULT_CONTEXT_SOURCE_PROVIDERS.flatMap((provider) => provider.collect(input));
}
