import { randomUUID } from "node:crypto";

import type { AgentConfig, CapabilityGrant, RunEnvelope } from "../types/index.js";

export function normalizeWorkspaceResourceRoots(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const root = String(item || "").trim();
    if (!root || seen.has(root)) continue;
    seen.add(root);
    out.push(root);
    if (out.length >= 12) break;
  }
  return out;
}

export function uniqueStrings(values: string[], limit = 64): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= limit) break;
  }
  return out;
}

export function readCapabilityGrant(meta?: Record<string, unknown>): CapabilityGrant | null {
  const raw = meta?.capabilityGrant;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const budgetsRaw =
    record.budgets && typeof record.budgets === "object" && !Array.isArray(record.budgets)
      ? (record.budgets as Record<string, unknown>)
      : {};
  const readInt = (value: unknown, fallback: number) => {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return fallback;
    return Math.trunc(num);
  };
  return {
    tools: uniqueStrings(Array.isArray(record.tools) ? record.tools.map(String) : []),
    readableRoots: uniqueStrings(Array.isArray(record.readableRoots) ? record.readableRoots.map(String) : []),
    writableRoots: uniqueStrings(Array.isArray(record.writableRoots) ? record.writableRoots.map(String) : []),
    network: record.network === "approved" ? "approved" : "none",
    budgets: {
      maxToolCalls: readInt(budgetsRaw.maxToolCalls, 32),
      maxTokens: readInt(budgetsRaw.maxTokens, 120000),
      maxWallTimeMs: readInt(budgetsRaw.maxWallTimeMs, 300000),
    },
  };
}

export function buildCapabilityGrant(params: {
  allToolNames: string[];
  dynamicToolNames: string[];
  allowedTools: Set<string> | null;
  workspaceRoot: string;
  localResourcePaths: string[];
  existingGrant: CapabilityGrant | null;
}): CapabilityGrant {
  if (params.existingGrant) {
    const mergedTools = params.allowedTools
      ? Array.from(params.allowedTools)
      : [...params.existingGrant.tools, ...params.dynamicToolNames];
    return {
      ...params.existingGrant,
      tools: uniqueStrings(mergedTools, 128),
    };
  }
  const readableRoots = uniqueStrings([
    params.workspaceRoot,
    ...params.localResourcePaths,
  ]);
  return {
    tools: uniqueStrings(
      params.allowedTools ? Array.from(params.allowedTools) : [...params.allToolNames, ...params.dynamicToolNames],
      128,
    ),
    readableRoots,
    writableRoots: [params.workspaceRoot],
    network: "approved",
    budgets: {
      maxToolCalls: 64,
      maxTokens: 120000,
      maxWallTimeMs: 300000,
    },
  };
}

export function buildRunEnvelope(params: {
  config: AgentConfig;
  prompt: string;
  sessionId?: string;
  capabilityGrant: CapabilityGrant;
  localResourcePaths: string[];
  requiredSkills: string[];
}): RunEnvelope {
  return {
    runId: randomUUID(),
    entrypoint: "run",
    userPrompt: params.prompt,
    ...(params.sessionId ? { sessionId: params.sessionId } : {}),
    workspaceRoot: params.config.workspaceRoot,
    modelPolicy: {
      defaultModel: params.config.model,
      maxTurns: params.config.maxTurns,
      maxAgentDepth: params.config.maxSubagentDepth,
    },
    capabilityGrant: params.capabilityGrant,
    contextRequest: {
      localResourcePaths: params.localResourcePaths,
      requiredSkills: params.requiredSkills,
    },
  };
}
