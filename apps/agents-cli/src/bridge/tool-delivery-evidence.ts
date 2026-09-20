import { isJsonObject, type JsonObject } from './contracts.js';
import type { RemoteToolExecution } from './mcp-gateway.js';

/** Inspect only tool-owned protocol containers, never prose or self-reported final text. */
export function findWorkflowReceipt(value: unknown, depth = 0): JsonObject | null {
  if (!isJsonObject(value) || depth > 4) return null;
  if (value.protocolVersion === 'tapcanvas.workflow-execution-receipt/v1') return value;
  for (const key of ['data', 'result', 'response']) {
    const receipt = findWorkflowReceipt(value[key], depth + 1);
    if (receipt) return receipt;
  }
  return null;
}

export function latestWorkflowReceipts(executions: readonly RemoteToolExecution[]): JsonObject[] {
  const byId = new Map<string, JsonObject>();
  for (const execution of executions) {
    const receipt = findWorkflowReceipt(execution.structuredOutput);
    if (receipt && typeof receipt.executionId === 'string' && receipt.executionId.trim()) byId.set(receipt.executionId, receipt);
  }
  return [...byId.values()];
}

function inspectVerifiedDelivery(value: unknown, expectedHash: string, depth = 0): JsonObject | null {
  if (!isJsonObject(value) || depth > 5) return null;
  const expected = isJsonObject(value.expectedDelivery) ? value.expectedDelivery : null;
  const verification = isJsonObject(value.deliveryVerification) ? value.deliveryVerification : null;
  const evidence = Array.isArray(value.deliveryEvidence) ? value.deliveryEvidence.filter(isJsonObject) : [];
  if (expected?.contractHash === expectedHash && verification?.contractHash === expectedHash
    && verification.status === 'satisfied' && evidence.length > 0 && Array.isArray(verification.criteria)
    && Array.isArray(expected.must) && expected.must.length > 0) {
    const evidenceIds = new Set(evidence.map(item => item.evidenceId));
    const covered = expected.must.every(requirement => isJsonObject(requirement) && typeof requirement.id === 'string'
      && verification.criteria instanceof Array && verification.criteria.some(criterion => isJsonObject(criterion)
        && criterion.requirementId === requirement.id && criterion.status === 'satisfied'
        && Array.isArray(criterion.evidenceIds) && criterion.evidenceIds.length > 0
        && criterion.evidenceIds.every(id => evidenceIds.has(id))));
    if (covered) return { expectedDelivery: expected, deliveryEvidence: evidence, deliveryVerification: verification };
  }
  for (const key of ['data', 'result', 'response', 'terminalDelivery']) {
    const verified = inspectVerifiedDelivery(value[key], expectedHash, depth + 1);
    if (verified) return verified;
  }
  return null;
}

export function verifiedToolDelivery(executions: readonly RemoteToolExecution[], contract: unknown): JsonObject | null {
  if (!isJsonObject(contract) || typeof contract.contractHash !== 'string') return null;
  const latestReceipts = new Set(latestWorkflowReceipts(executions));
  for (const execution of [...executions].reverse()) {
    if (execution.status !== 'succeeded') continue;
    const receipt = findWorkflowReceipt(execution.structuredOutput);
    if (receipt && (!latestReceipts.has(receipt) || receipt.acceptedAsync === true || receipt.terminal !== true || receipt.status !== 'success')) continue;
    const verified = inspectVerifiedDelivery(execution.structuredOutput, contract.contractHash);
    if (verified) return verified;
  }
  return null;
}
