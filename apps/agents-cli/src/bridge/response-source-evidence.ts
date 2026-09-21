import type { JsonObject } from './contracts.js';
import type { RemoteToolExecution } from './mcp-gateway.js';

/** Settled request-scoped facts; tool names never determine semantic relevance. */
export function responseSourceEvidence(executions: readonly RemoteToolExecution[]): JsonObject[] {
  const internalTools = new Set(['report_delivery', 'record_user_intent', 'submit_structured_output', 'get_delivery_evidence']);
  return executions.flatMap((execution, index) => execution.status === 'succeeded' && !internalTools.has(execution.name) ? [{
    evidenceId: `source:${index}`, kind: 'source', sourceRef: `tool:${index}`,
    attributes: { toolName: execution.name, status: execution.status, args: execution.args,
      output: execution.structuredOutput ?? execution.outputText, finishedAt: execution.finishedAt },
  }] : []);
}

export function bindResponseSources(requirements: readonly JsonObject[], executions: readonly RemoteToolExecution[]): {
  evidence: JsonObject[]; byRequirement: Record<string, string[]>; error: string | null;
} {
  const catalog = new Map(responseSourceEvidence(executions).map(item => [item.evidenceId, item]));
  const selected = new Map<string, JsonObject>();
  const byRequirement: Record<string, string[]> = {};
  for (const requirement of requirements) {
    if (typeof requirement.id !== 'string') return { evidence: [], byRequirement: {}, error: 'Requirement identity missing.' };
    const ids = requirement.sourceEvidenceIds;
    if (ids !== undefined && (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !catalog.has(id)))) {
      return { evidence: [], byRequirement: {}, error: `Unknown or failed source evidence for ${requirement.id}.` };
    }
    if (requirement.requiresToolEvidence === true && (!Array.isArray(ids) || !ids.length)) {
      return { evidence: [], byRequirement: {}, error: `Requirement ${requirement.id} needs a settled successful tool receipt, not final prose.` };
    }
    const bound = Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
    byRequirement[requirement.id] = bound;
    for (const id of bound) selected.set(id, catalog.get(id)!);
  }
  return { evidence: [...selected.values()], byRequirement, error: null };
}
