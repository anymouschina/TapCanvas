import { isDeepStrictEqual } from "node:util";
import { createHash } from 'node:crypto';
import { isJsonObject, type JsonObject, type RemoteToolDefinition } from './contracts.js';
import type { RemoteToolExecution } from './mcp-gateway.js';
import { findWorkflowReceipt, latestWorkflowReceipts } from './tool-delivery-evidence.js';

export const DELIVERY_EVIDENCE_TOOL: RemoteToolDefinition = {
  name: 'get_delivery_evidence', description: 'Read the real successful terminal workflow outputs available for final delivery self-check. Use exact evidence IDs in report_delivery. Async acceptance never supplies terminal evidence.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
};
export const ARTIFACT_REPORT_PARAMETERS: JsonObject = {
  type: 'object', additionalProperties: false,
  properties: {
    expectedDelivery: { type: 'object', description: 'The frozen UserIntentContract, or an explicit agent-authored delivery contract if none was supplied. Include delivery.mode, delivery.mediaType and every must requirement with id and statement.' },
    criteria: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: false,
      properties: { requirementId: { type: 'string' }, evidenceIds: { type: 'array', minItems: 1, items: { type: 'string' } }, rationale: { type: 'string', minLength: 1 } }, required: ['requirementId', 'evidenceIds', 'rationale'] } },
    rationale: { type: 'string', minLength: 1 },
  }, required: ['expectedDelivery', 'criteria', 'rationale'],
};

export function deliveryEvidenceCatalog(executions: readonly RemoteToolExecution[]): JsonObject[] {
  const entries: JsonObject[] = [];
  const latestReceipts = new Set(latestWorkflowReceipts(executions));
  executions.forEach((execution, index) => {
    if (execution.status !== 'succeeded') return;
    const receipt = findWorkflowReceipt(execution.structuredOutput);
    if (!receipt || !latestReceipts.has(receipt) || receipt.terminal !== true || receipt.status !== 'success' || receipt.acceptedAsync === true
      || typeof receipt.executionId !== 'string' || !receipt.executionId || !Array.isArray(receipt.workflowOutputs)) return;
    const visit = (value: unknown, path: readonly (string | number)[]): void => {
      if (value === null || value === undefined) return;
      if (Array.isArray(value)) { value.forEach((item, itemIndex) => visit(item, [...path, itemIndex])); return; }
      if (isJsonObject(value)) { for (const [key, item] of Object.entries(value)) visit(item, [...path, key]); return; }
      const evidenceId = `tool-output:${index}:${JSON.stringify(path)}`;
      entries.push({ evidenceId, kind: 'workflow_output', sourceRef: receipt.executionId, toolName: execution.name,
        executionId: receipt.executionId, path, value });
    };
    receipt.workflowOutputs.forEach((output, outputIndex) => {
      if (isJsonObject(output) && isJsonObject(output.ports)) visit(output.ports, ['workflowOutputs', outputIndex, 'ports']);
    });
  });
  return entries;
}

function httpUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try { const url = new URL(value); return url.protocol === 'https:' || url.protocol === 'http:'; } catch { return false; }
}

export function inspectArtifactDeliveryReport(input: { args: JsonObject; frozenContract: JsonObject | null; executions: readonly RemoteToolExecution[] }): {
  delivery: JsonObject | null; error: string | null;
} {
  const expected = isJsonObject(input.args.expectedDelivery) ? input.args.expectedDelivery : null;
  if (!expected || !isJsonObject(expected.delivery) || (typeof expected.delivery.mode !== 'string' || !expected.delivery.mode.trim() || expected.delivery.mode === 'response') || !Array.isArray(expected.must)
    || expected.must.length === 0 || !Array.isArray(input.args.criteria) || typeof input.args.rationale !== 'string' || !input.args.rationale.trim()) {
    return { delivery: null, error: 'Artifact report requires explicit delivery, nonempty must criteria and rationale.' };
  }
  if (input.frozenContract && !isDeepStrictEqual(input.frozenContract, expected)) {
    return { delivery: null, error: 'Expected delivery must preserve the complete frozen user intent contract.' };
  }
  const catalog = deliveryEvidenceCatalog(input.executions);
  const catalogById = new Map(catalog.map(item => [item.evidenceId, item]));
  const ids = new Set<string>();
  const criteria: JsonObject[] = [];
  const used = new Map<string, JsonObject>();
  for (const requirement of expected.must) {
    if (!isJsonObject(requirement) || typeof requirement.id !== 'string' || !requirement.id.trim() || ids.has(requirement.id) || typeof requirement.statement !== 'string' || !requirement.statement.trim()) {
      return { delivery: null, error: 'Must requirement identities must be unique with explicit statements.' };
    }
    ids.add(requirement.id);
    const matching = input.args.criteria.filter(item => isJsonObject(item) && item.requirementId === requirement.id);
    const criterion = matching.length === 1 && isJsonObject(matching[0]) ? matching[0] : null;
    if (!criterion || !Array.isArray(criterion.evidenceIds) || !criterion.evidenceIds.length || typeof criterion.rationale !== 'string' || !criterion.rationale.trim()) {
      return { delivery: null, error: `Missing semantic self-check and evidence for ${requirement.id}.` };
    }
    for (const id of criterion.evidenceIds) {
      const evidence = catalogById.get(id);
      if (typeof id !== 'string' || !evidence) return { delivery: null, error: `Unknown terminal tool evidence: ${String(id)}.` };
      used.set(id, evidence);
    }
    criteria.push({ ...criterion, status: 'satisfied' });
  }
  if (input.args.criteria.length !== criteria.length) return { delivery: null, error: 'Every submitted criterion must match exactly one frozen requirement.' };
  if (expected.delivery.mediaType !== null && expected.delivery.mediaType !== undefined && ![...used.values()].some(item => httpUrl(item.value))) {
    return { delivery: null, error: 'Media delivery requires a real persistent HTTP(S) asset locator from terminal workflow output.' };
  }
  const contractHash = typeof expected.contractHash === 'string' ? expected.contractHash
    : `sha256:${createHash('sha256').update(JSON.stringify(expected)).digest('hex')}`;
  return { delivery: { expectedDelivery: { ...expected, contractHash }, deliveryEvidence: [...used.values()],
    deliveryVerification: { version: 2, contractHash, status: 'satisfied', criteria, verifiedAt: new Date().toISOString(), rationale: input.args.rationale } }, error: null };
}
