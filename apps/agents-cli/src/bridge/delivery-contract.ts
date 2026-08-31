import { createHash } from "node:crypto";

import type { JsonObject } from "./contracts.js";
import { BridgeRequestError, isJsonObject } from "./contracts.js";
import type {
  HarnessDeliveryReport,
  RemoteToolExecution,
} from "./mcp-gateway.js";

type CompletionSource = "runtime" | "terminal_delivery_verifier";

export type HarnessDeliveryClosure = Readonly<{
  runtime: JsonObject;
  completion: JsonObject;
  runOutcome: JsonObject;
  succeeded: boolean;
}>;

type FrozenResponseContract = Readonly<{
  value: JsonObject;
  contractHash: string;
  requirementIds: readonly string[];
  successCriteria: readonly string[];
  workflowReceipt?: Readonly<{
    executionId: string;
    toolName: string;
  }>;
}>;

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function logicalTaskId(turnContext: JsonObject): string {
  const value = nonEmptyString(turnContext.logicalTaskId)
    ?? nonEmptyString(turnContext.publicTurnId);
  if (!value) {
    throw new BridgeRequestError(
      "DeepSeek Harness 运行缺少 logicalTaskId/publicTurnId，无法提交物理退出合同",
      "deepseek_harness_logical_task_id_required",
      502,
    );
  }
  return value;
}

function taskRevision(turnContext: JsonObject): number {
  const value = turnContext.taskRevision;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

function readFrozenResponseContract(value: unknown): FrozenResponseContract | null {
  if (!isJsonObject(value) || value.version !== 2) return null;
  const contractHash = nonEmptyString(value.contractHash);
  const delivery = isJsonObject(value.delivery) ? value.delivery : null;
  const unresolved = Array.isArray(value.unresolved) ? value.unresolved : null;
  if (
    !contractHash
    || !delivery
    || delivery.mode !== "response"
    || delivery.mediaType !== null
    || !nonEmptyString(delivery.kind)
    || !nonEmptyString(delivery.output)
    || !unresolved
    || unresolved.length > 0
    || !Array.isArray(value.must)
  ) return null;

  const requirementIds: string[] = [];
  const successCriteria: string[] = [];
  const seen = new Set<string>();
  for (const item of value.must) {
    if (!isJsonObject(item)) return null;
    const id = nonEmptyString(item.id);
    const statement = nonEmptyString(item.statement);
    if (!id || !statement || seen.has(id)) return null;
    seen.add(id);
    requirementIds.push(id);
    successCriteria.push(statement);
  }
  if (requirementIds.length === 0) return null;
  return { value, contractHash, requirementIds, successCriteria };
}

function findWorkflowExecutionReceipt(value: unknown, depth = 0): JsonObject | null {
  if (!isJsonObject(value) || depth > 3) return null;
  if (value.protocolVersion === "tapcanvas.workflow-execution-receipt/v1") return value;
  for (const key of ["data", "result", "response"] as const) {
    const nested = findWorkflowExecutionReceipt(value[key], depth + 1);
    if (nested) return nested;
  }
  return null;
}

function readSingleWorkflowResponseText(receipt: JsonObject): string | null {
  if (receipt.terminal !== true || receipt.status !== "success") return null;
  if (!Array.isArray(receipt.workflowOutputs)) return null;
  const texts: string[] = [];
  for (const candidate of receipt.workflowOutputs) {
    if (!isJsonObject(candidate)) return null;
    const ports = isJsonObject(candidate.ports) ? candidate.ports : null;
    const output = isJsonObject(ports?.output) ? ports.output : null;
    if (!Array.isArray(output?.text)) continue;
    for (const text of output.text) {
      if (typeof text !== "string" || text.length === 0) return null;
      texts.push(text);
    }
  }
  return texts.length === 1 ? texts[0]! : null;
}

function readFrozenWorkflowResponseContract(
  executions: readonly RemoteToolExecution[],
  finalText: string,
): FrozenResponseContract | null {
  for (let index = executions.length - 1; index >= 0; index -= 1) {
    const execution = executions[index];
    if (!execution || execution.status !== "succeeded" || !execution.structuredOutput) continue;
    const receipt = findWorkflowExecutionReceipt(execution.structuredOutput);
    if (!receipt) continue;
    const workflowText = readSingleWorkflowResponseText(receipt);
    const executionId = nonEmptyString(receipt.executionId);
    if (!workflowText || !executionId || finalText !== workflowText) continue;
    const requirementId = "must:workflow-authored-response-exact";
    const statement = "最终响应逐字等于成功工作流的唯一标准文本输出";
    const unsignedContract: JsonObject = {
      version: 2,
      referenceResolution: {
        mode: "workflow_execution_receipt",
        executionId,
      },
      delivery: {
        mode: "response",
        mediaType: null,
        kind: "workflow_authored_response",
        output: "原样交付成功工作流的唯一标准文本输出",
      },
      must: [{
        id: requirementId,
        statement,
        source: "workflow_execution_receipt",
        evidence: ["terminal workflow.output/v1", "exact final response"],
      }],
      forbid: [],
      prefer: [],
      confirmedFacts: [{ executionId, toolName: execution.name }],
      unresolved: [],
      precedence: ["provider_protocol_limits", "workflow_authored_output"],
    };
    const contractHash = `sha256:${createHash("sha256")
      .update(JSON.stringify(unsignedContract), "utf8")
      .digest("hex")}`;
    return {
      value: { ...unsignedContract, contractHash },
      contractHash,
      requirementIds: [requirementId],
      successCriteria: [statement],
      workflowReceipt: { executionId, toolName: execution.name },
    };
  }
  return null;
}

function physicalExit(input: {
  turnContext: JsonObject;
  succeeded: boolean;
  reasonCode: string;
  exitedAt: string;
}): JsonObject {
  return {
    version: 1,
    kind: "logical_terminal",
    logicalTaskId: logicalTaskId(input.turnContext),
    taskNodeId: nonEmptyString(input.turnContext.taskNodeId) ?? "root",
    taskRevision: taskRevision(input.turnContext),
    taskStatus: input.succeeded ? "satisfied" : "failed",
    reasonCode: input.reasonCode,
    exitedAt: input.exitedAt,
    continuationTicket: null,
  };
}

function completion(input: {
  source: CompletionSource;
  succeeded: boolean;
  reason: string;
  successCriteria: readonly string[];
}): JsonObject {
  return {
    version: 1,
    source: input.source,
    terminal: input.succeeded ? "success" : "failure",
    allowFinish: input.succeeded,
    failureReason: input.succeeded ? null : input.reason,
    rationale: input.reason,
    successCriteria: [...input.successCriteria],
    missingCriteria: input.succeeded ? [] : [...input.successCriteria],
    requiredActions: [],
  };
}

function runOutcome(succeeded: boolean, reason: string): JsonObject {
  return {
    version: 1,
    terminal: true,
    status: succeeded ? "succeeded" : "failed",
    reason,
  };
}

function failedClosure(input: {
  turnContext: JsonObject;
  reasonCode: string;
  rationale: string;
  exitedAt: string;
  successCriteria?: readonly string[];
}): HarnessDeliveryClosure {
  return {
    runtime: {
      terminalAuthority: input.turnContext.executeForcedAgentDirectly === true
        ? "workflow_action"
        : "user_delivery",
      physicalRunExit: physicalExit({
        turnContext: input.turnContext,
        succeeded: false,
        reasonCode: input.reasonCode,
        exitedAt: input.exitedAt,
      }),
    },
    completion: completion({
      source: "runtime",
      succeeded: false,
      reason: input.rationale,
      successCriteria: input.successCriteria ?? [],
    }),
    runOutcome: runOutcome(false, input.reasonCode),
    succeeded: false,
  };
}

/**
 * Closes one DeepSeek Harness physical run using TapCanvas's durable protocol.
 * The function only projects frozen structured facts. It never infers intent
 * from prompt text. Response delivery is bound to the exact emitted text hash;
 * executable/state-changing delivery must supply its own tool-backed verifier
 * and therefore fails explicitly until that verifier is present.
 */
export function buildHarnessDeliveryClosure(input: {
  turnContext: JsonObject;
  text: string;
  harnessCompleted: boolean;
  deliveryReport?: HarnessDeliveryReport | null;
  remoteExecutions?: readonly RemoteToolExecution[];
  exitedAt?: string;
}): HarnessDeliveryClosure {
  const exitedAt = input.exitedAt ?? new Date().toISOString();
  const authority = input.turnContext.executeForcedAgentDirectly === true
    ? "workflow_action"
    : "user_delivery";

  if (!input.harnessCompleted) {
    return failedClosure({
      turnContext: input.turnContext,
      reasonCode: "deepseek_harness_turn_incomplete",
      rationale: "DeepSeek Harness did not reach a completed turn boundary.",
      exitedAt,
    });
  }

  if (authority === "workflow_action") {
    const reasonCode = "workflow_action_completed";
    return {
      runtime: {
        terminalAuthority: authority,
        physicalRunExit: physicalExit({
          turnContext: input.turnContext,
          succeeded: true,
          reasonCode,
          exitedAt,
        }),
      },
      completion: completion({
        source: "runtime",
        succeeded: true,
        reason: "DeepSeek Harness completed the atomic workflow action.",
        successCriteria: [],
      }),
      runOutcome: runOutcome(true, reasonCode),
      succeeded: true,
    };
  }

  const frozenContract = readFrozenResponseContract(
    input.turnContext.userIntentContract ?? input.deliveryReport?.expectedDelivery,
  ) ?? readFrozenWorkflowResponseContract(input.remoteExecutions ?? [], input.text);
  if (!frozenContract || !input.text.trim()) {
    return failedClosure({
      turnContext: input.turnContext,
      reasonCode: "delivery_verification_missing",
      rationale:
        "The run did not provide a non-empty final response bound to a valid frozen response delivery contract.",
      exitedAt,
      successCriteria: frozenContract?.successCriteria,
    });
  }

  const evidenceId = "runtime-final-response";
  const textSha256 = createHash("sha256").update(input.text, "utf8").digest("hex");
  const evidence: JsonObject = {
    evidenceId,
    kind: "final_response",
    sourceRef: "final_response",
    requirementIds: [...frozenContract.requirementIds],
    attributes: { sha256: textSha256 },
  };
  const workflowEvidenceId = frozenContract.workflowReceipt
    ? "runtime-workflow-execution-receipt"
    : null;
  const deliveryEvidence: JsonObject[] = [
    ...(frozenContract.workflowReceipt ? [{
      evidenceId: workflowEvidenceId!,
      kind: "tool_call",
      sourceRef: `workflow_execution:${frozenContract.workflowReceipt.executionId}`,
      requirementIds: [...frozenContract.requirementIds],
      attributes: {
        toolName: frozenContract.workflowReceipt.toolName,
        executionId: frozenContract.workflowReceipt.executionId,
        terminal: true,
        status: "success",
      },
    }] : []),
    evidence,
  ];
  const criterionEvidenceIds = workflowEvidenceId
    ? [workflowEvidenceId, evidenceId]
    : [evidenceId];
  const verification: JsonObject = {
    version: 2,
    contractHash: frozenContract.contractHash,
    status: "satisfied",
    criteria: frozenContract.requirementIds.map((requirementId) => ({
      requirementId,
      status: "satisfied",
      evidenceIds: criterionEvidenceIds,
      reason: workflowEvidenceId
        ? "The runtime verified a successful terminal workflow receipt and exact equality between its sole authored text output and the emitted final response."
        : "DeepSeek Harness completed the frozen response requirement and the runtime bound the emitted final response by SHA-256.",
    })),
    verifiedAt: exitedAt,
  };
  const reasonCode = "delivery_verified";
  const terminalDelivery: JsonObject = {
    version: 1,
    requestTerminal: {
      version: 1,
      terminal: true,
      status: "succeeded",
      reason: reasonCode,
    },
    expectedDelivery: frozenContract.value,
    deliveryEvidence,
    deliveryVerification: verification,
  };
  return {
    runtime: {
      terminalAuthority: authority,
      userIntentContract: frozenContract.value,
      physicalRunExit: physicalExit({
        turnContext: input.turnContext,
        succeeded: true,
        reasonCode,
        exitedAt,
      }),
      terminalDelivery,
    },
    completion: completion({
      source: "terminal_delivery_verifier",
      succeeded: true,
      reason: "The frozen response contract is bound to the exact emitted final response.",
      successCriteria: frozenContract.successCriteria,
    }),
    runOutcome: runOutcome(true, reasonCode),
    succeeded: true,
  };
}
