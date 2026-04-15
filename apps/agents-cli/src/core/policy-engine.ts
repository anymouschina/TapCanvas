import path from "node:path";

import type {
  CapabilityGrant,
  ToolPolicyDecision,
  ToolPolicySource,
  ToolPolicySummary,
} from "../types/index.js";

const PRIVILEGED_LOCAL_TOOLS = new Set([
  "bash",
  "write_file",
  "append_file",
  "edit_file",
  "exec_command",
  "write_stdin",
]);

type PolicyEngineInput = {
  toolName: string;
  args?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  cwd?: string;
};

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

function readCapabilityGrant(meta?: Record<string, unknown>): CapabilityGrant | null {
  const raw = meta?.capabilityGrant;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const budgetsRaw =
    record.budgets && typeof record.budgets === "object" && !Array.isArray(record.budgets)
      ? record.budgets as Record<string, unknown>
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

function looksLikeWriteCommand(command: string): boolean {
  return /\b(rm|mv|cp|tee|sed|perl|python|node|cat)\b/.test(command) || /[>]{1,2}/.test(command);
}

function normalizePathMentions(args: Record<string, unknown> | undefined, cwd: string | undefined): string[] {
  if (!args || !cwd) return [];
  const mentions: string[] = [];
  for (const key of ["path", "paths", "file", "target"]) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) mentions.push(value.trim());
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === "string" && entry.trim()) mentions.push(entry.trim());
      }
    }
  }
  return uniqueStrings(
    mentions.map((entry) => path.resolve(cwd, entry)),
  );
}

function readPolicySummary(meta?: Record<string, unknown>): ToolPolicySummary {
  const raw = meta?.policySummary;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      totalDecisions: 0,
      allowCount: 0,
      denyCount: 0,
      requiresApprovalCount: 0,
      uniqueDeniedSignatures: [],
    };
  }
  const record = raw as Record<string, unknown>;
  return {
    totalDecisions: Number(record.totalDecisions ?? 0) || 0,
    allowCount: Number(record.allowCount ?? 0) || 0,
    denyCount: Number(record.denyCount ?? 0) || 0,
    requiresApprovalCount: Number(record.requiresApprovalCount ?? 0) || 0,
    uniqueDeniedSignatures: uniqueStrings(
      Array.isArray(record.uniqueDeniedSignatures) ? record.uniqueDeniedSignatures.map(String) : [],
    ),
  };
}

function writePolicySummary(meta: Record<string, unknown> | undefined, decision: ToolPolicyDecision): void {
  if (!meta) return;
  const current = readPolicySummary(meta);
  const signature = `${decision.source}:${decision.scope}:${decision.reason}`;
  const next: ToolPolicySummary = {
    totalDecisions: current.totalDecisions + 1,
    allowCount: current.allowCount + (decision.verdict === "allow" ? 1 : 0),
    denyCount: current.denyCount + (decision.verdict === "deny" ? 1 : 0),
    requiresApprovalCount: current.requiresApprovalCount + (decision.verdict === "requires_approval" ? 1 : 0),
    uniqueDeniedSignatures:
      decision.verdict === "allow"
        ? current.uniqueDeniedSignatures
        : uniqueStrings([...current.uniqueDeniedSignatures, signature]),
  };
  meta.policySummary = next;
}

function buildDecision(
  verdict: ToolPolicyDecision["verdict"],
  reason: string,
  source: ToolPolicySource,
  scope: ToolPolicyDecision["scope"],
): ToolPolicyDecision {
  return { verdict, reason, source, scope };
}

export function evaluateToolPolicy(input: PolicyEngineInput): ToolPolicyDecision {
  const grant = readCapabilityGrant(input.meta);
  if (grant && !grant.tools.includes(input.toolName)) {
    return buildDecision(
      "deny",
      `策略拦截：tool ${input.toolName} 不在当前 capability grant 内。`,
      "runtime_grant",
      "tool",
    );
  }

  const meta = input.meta;
  const isRemoteScopedUser = typeof meta?.userId === "string" && meta.userId.trim().length > 0;
  const privilegedLocalAccess = meta?.privilegedLocalAccess === true;
  const forceLocalResourceViaBash = meta?.forceLocalResourceViaBash === true;
  if (isRemoteScopedUser && PRIVILEGED_LOCAL_TOOLS.has(input.toolName) && !privilegedLocalAccess) {
    if (input.toolName === "bash" && forceLocalResourceViaBash) {
      return buildDecision("allow", "", "request", "tool");
    }
    return buildDecision(
      "requires_approval",
      `策略拦截：远程会话执行 ${input.toolName} 需要显式审批或 privilegedLocalAccess。`,
      "user",
      "tool",
    );
  }

  const cwd = input.cwd;
  const pathMentions = normalizePathMentions(input.args, cwd);
  if (grant && pathMentions.length > 0) {
    const writableRoots = new Set(grant.writableRoots.map((root) => path.resolve(root)));
    const readableRoots = new Set([...grant.readableRoots, ...grant.writableRoots].map((root) => path.resolve(root)));
    if (input.toolName === "write_file" || input.toolName === "append_file" || input.toolName === "edit_file") {
      const blockedPath = pathMentions.find((target) => !Array.from(writableRoots).some((root) => target.startsWith(root)));
      if (blockedPath) {
        return buildDecision(
          "deny",
          `策略拦截：路径 ${blockedPath} 不在 capability writableRoots 内。`,
          "runtime_grant",
          "path",
        );
      }
    } else if (input.toolName === "read_file" || input.toolName === "read_file_range") {
      const blockedPath = pathMentions.find((target) => !Array.from(readableRoots).some((root) => target.startsWith(root)));
      if (blockedPath) {
        return buildDecision(
          "deny",
          `策略拦截：路径 ${blockedPath} 不在 capability readableRoots 内。`,
          "runtime_grant",
          "path",
        );
      }
    }
  }

  if ((input.toolName === "bash" || input.toolName === "exec_command") && input.args) {
    const command = typeof input.args.command === "string" ? input.args.command.trim() : "";
    if (command && looksLikeWriteCommand(command) && meta?.privilegedLocalAccess !== true) {
      return buildDecision(
        "requires_approval",
        `策略拦截：命令包含写入或破坏性副作用，需显式审批后才能执行。`,
        "request",
        "command",
      );
    }
  }

  return buildDecision("allow", "", grant ? "runtime_grant" : "system", "tool");
}

export function recordPolicyDecision(meta: Record<string, unknown> | undefined, decision: ToolPolicyDecision): void {
  writePolicySummary(meta, decision);
}
