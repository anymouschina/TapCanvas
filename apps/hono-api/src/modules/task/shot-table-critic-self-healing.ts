import type { CriticApiStyle } from "../agents/agents-llm-proxy";
import {
  parseShotTableCriticOutput,
  type ShotTableCriticModelVerdict,
  type ShotTableCriticOutputDiagnostic,
} from "./shot-table-critic-output";

const MAX_ATTEMPTS = 2;
const MAX_PREVIOUS_OUTPUT_CHARS = 16_000;

export type ShotTableCriticExecutionIdentity = {
  model: string;
  apiStyle: CriticApiStyle;
};

export type ShotTableCriticInvocation = ShotTableCriticExecutionIdentity & {
  attempt: 1 | 2;
  phase: "evaluation" | "same_model_structure_repair";
  system: string;
  user: string;
};

export type ShotTableCriticInvoker = (
  invocation: ShotTableCriticInvocation,
) => Promise<string>;

export type ShotTableCriticAttemptDiagnostic =
  | (ShotTableCriticOutputDiagnostic & {
      attempt: 1 | 2;
      phase: ShotTableCriticInvocation["phase"];
      model: string;
      apiStyle: CriticApiStyle;
      failureKind: "output_contract";
    })
  | {
      attempt: 1 | 2;
      phase: ShotTableCriticInvocation["phase"];
      model: string;
      apiStyle: CriticApiStyle;
      failureKind: "upstream_request";
      failureReason: "critic_upstream_request_failed";
      missingCriteria: string[];
      requiredActions: string[];
      rawChars: 0;
      candidateCount: 0;
      upstreamError: string;
    };

export type ShotTableCriticSelfHealingResult = {
  verdict: ShotTableCriticModelVerdict | null;
  attemptsUsed: 1 | 2;
  repaired: boolean;
  diagnostics: ShotTableCriticAttemptDiagnostic[];
};

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/https?:\/\/\S+/g, "[url]").slice(0, 240) || "unknown upstream error";
}

function buildRequestFailureDiagnostic(
  invocation: ShotTableCriticInvocation,
  error: unknown,
): ShotTableCriticAttemptDiagnostic {
  return {
    attempt: invocation.attempt,
    phase: invocation.phase,
    model: invocation.model,
    apiStyle: invocation.apiStyle,
    failureKind: "upstream_request",
    failureReason: "critic_upstream_request_failed",
    missingCriteria: ["critic_response_received"],
    requiredActions: [
      "保持同一 model 与 apiStyle，仅进行一次有界重试",
      "若再次失败则显式终止并保留失败诊断",
    ],
    rawChars: 0,
    candidateCount: 0,
    upstreamError: sanitizeError(error),
  };
}

function attachAttemptFacts(
  invocation: ShotTableCriticInvocation,
  diagnostic: ShotTableCriticOutputDiagnostic,
): ShotTableCriticAttemptDiagnostic {
  return {
    ...diagnostic,
    attempt: invocation.attempt,
    phase: invocation.phase,
    model: invocation.model,
    apiStyle: invocation.apiStyle,
    failureKind: "output_contract",
  };
}

function boundPreviousOutput(raw: string): { text: string; truncated: boolean } {
  if (raw.length <= MAX_PREVIOUS_OUTPUT_CHARS) return { text: raw, truncated: false };
  const half = Math.floor(MAX_PREVIOUS_OUTPUT_CHARS / 2);
  return {
    text: `${raw.slice(0, half)}\n<critic_output_middle_truncated/>\n${raw.slice(-half)}`,
    truncated: true,
  };
}

export function buildShotTableCriticRepairMessages(input: {
  rubric: string;
  userMessage: string;
  execution: ShotTableCriticExecutionIdentity;
  diagnostic: ShotTableCriticAttemptDiagnostic;
  previousOutput: string;
}): { system: string; user: string } {
  const boundedOutput = boundPreviousOutput(input.previousOutput);
  const repairFacts = {
    failureReason: input.diagnostic.failureReason,
    missingCriteria: input.diagnostic.missingCriteria,
    requiredActions: input.diagnostic.requiredActions,
    previousOutputChars: input.previousOutput.length,
    previousOutputIncludedInFull: !boundedOutput.truncated,
    inheritedExecution: input.execution,
  };
  const system = [
    input.rubric,
    "<runtime_critic_self_repair>",
    "上一轮 critic 调用已经产生真实失败。你只能修复输出结构，不能切换模型、改变评审对象或省略维度。",
    "这是唯一一次同模型自愈机会。根据 failure facts 修复完整 verdict，只返回一个紧凑 JSON。",
    `failure facts: ${JSON.stringify(repairFacts)}`,
    "</runtime_critic_self_repair>",
  ].join("\n");
  const user = [
    input.userMessage,
    "<previous_critic_output>",
    boundedOutput.text || "（上游未返回可用文本；请基于原评审材料重新输出完整 verdict。）",
    "</previous_critic_output>",
    "只输出修复后的完整 JSON；不要解释修复过程。",
  ].join("\n");
  return { system, user };
}

export async function evaluateShotTableCriticWithSelfHealing(input: {
  rubric: string;
  userMessage: string;
  execution: ShotTableCriticExecutionIdentity;
  invoke: ShotTableCriticInvoker;
  onDiagnostic?: (diagnostic: ShotTableCriticAttemptDiagnostic) => void;
}): Promise<ShotTableCriticSelfHealingResult> {
  const diagnostics: ShotTableCriticAttemptDiagnostic[] = [];
  let previousOutput = "";
  let previousDiagnostic: ShotTableCriticAttemptDiagnostic | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const typedAttempt = attempt as 1 | 2;
    const phase: ShotTableCriticInvocation["phase"] =
      typedAttempt === 1 ? "evaluation" : "same_model_structure_repair";
    const repairMessages =
      typedAttempt === 2 && previousDiagnostic
        ? buildShotTableCriticRepairMessages({
            rubric: input.rubric,
            userMessage: input.userMessage,
            execution: input.execution,
            diagnostic: previousDiagnostic,
            previousOutput,
          })
        : { system: input.rubric, user: input.userMessage };
    const invocation: ShotTableCriticInvocation = {
      ...input.execution,
      attempt: typedAttempt,
      phase,
      ...repairMessages,
    };

    try {
      const raw = await input.invoke(invocation);
      previousOutput = raw;
      const parsed = parseShotTableCriticOutput(raw);
      if (parsed.ok) {
        return {
          verdict: parsed.verdict,
          attemptsUsed: typedAttempt,
          repaired: typedAttempt === 2,
          diagnostics,
        };
      }
      previousDiagnostic = attachAttemptFacts(invocation, parsed.diagnostic);
    } catch (error) {
      previousOutput = "";
      previousDiagnostic = buildRequestFailureDiagnostic(invocation, error);
    }

    diagnostics.push(previousDiagnostic);
    input.onDiagnostic?.(previousDiagnostic);
  }

  return { verdict: null, attemptsUsed: 2, repaired: false, diagnostics };
}
