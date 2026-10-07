import type { WorkerEnv } from '../../types';
import { runWorkflowAgentNode } from '../execution/execution.agent-runner';
import type { WorkflowAgentRunRequest } from '../execution/execution.node-executors';

export type SemanticRecallRequest = Readonly<{
  scope: string; query: string; documents: readonly Readonly<{ id: string; text: string }>[]; limit?: number;
}>;
export type SemanticRecallResponse = Readonly<{
  scope: string; results: readonly Readonly<{ id: string; score: number }>[];
  diagnostics: Readonly<{ model: string; documents: number }>;
}>;
export type SemanticRecallExecutionIdentity = Readonly<{
  executionId: string; executionFamilyId: string; nodeId: string;
  ownerId: string; flowId: string; projectId: string | null; modelKey: string;
  reasoningEffort?: WorkflowAgentRunRequest['reasoningEffort'];
}>;

export function semanticRecallSchema(input: SemanticRecallRequest, identity: SemanticRecallExecutionIdentity): Record<string, unknown> {
  const ids = input.documents.map(document => document.id);
  if (!input.scope.trim() || !input.query.trim() || !ids.length || ids.some(id => !id.trim())
    || new Set(ids).size !== ids.length || input.documents.some(document => !document.text.trim())) {
    throw new Error('semantic_recall_input_invalid');
  }
  if (!identity.executionId.trim() || !identity.executionFamilyId.trim() || !identity.nodeId.trim()
    || !identity.ownerId.trim() || !identity.flowId.trim() || !identity.modelKey.trim()) {
    throw new Error('semantic_recall_execution_identity_required');
  }
  if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1)) {
    throw new Error('semantic_recall_limit_invalid');
  }
  const count = Math.min(input.limit ?? ids.length, ids.length);
  return { type: 'object', required: ['scope', 'results', 'diagnostics'], additionalProperties: false,
    properties: {
      scope: { type: 'string', const: input.scope },
      results: { type: 'array', minItems: count, maxItems: count, uniqueItems: true,
        items: { type: 'object', additionalProperties: false, required: ['id', 'score'],
          properties: { id: { type: 'string', enum: ids }, score: { type: 'number', minimum: 0, maximum: 1 } } } },
      diagnostics: { type: 'object', additionalProperties: false, required: ['model', 'documents'],
        properties: { model: { type: 'string', const: identity.modelKey }, documents: { type: 'integer', const: ids.length } } },
    } };
}

export function parseSemanticRecallResponse(value: unknown, input: SemanticRecallRequest,
  identity: SemanticRecallExecutionIdentity): SemanticRecallResponse {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const diagnostics = record?.diagnostics && typeof record.diagnostics === 'object' && !Array.isArray(record.diagnostics)
    ? record.diagnostics as Record<string, unknown> : null;
  const count = Math.min(input.limit ?? input.documents.length, input.documents.length);
  const allowed = new Set(input.documents.map(document => document.id));
  const seen = new Set<string>();
  if (record?.scope !== input.scope || diagnostics?.model !== identity.modelKey
    || diagnostics?.documents !== input.documents.length || !Array.isArray(record?.results) || record.results.length !== count) {
    throw new Error('semantic_recall_output_contract_invalid');
  }
  const results = record.results.map((item: unknown) => {
    const entry = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : null;
    if (typeof entry?.id !== 'string' || !allowed.has(entry.id) || seen.has(entry.id)
      || typeof entry.score !== 'number' || !Number.isFinite(entry.score) || entry.score < 0 || entry.score > 1) {
      throw new Error('semantic_recall_result_identity_invalid');
    }
    seen.add(entry.id);
    return { id: entry.id, score: entry.score };
  });
  return { scope: input.scope, results, diagnostics: { model: identity.modelKey, documents: input.documents.length } };
}

/** Semantic ordering belongs to the existing Agent execution channel, with its frozen model. */
export async function recallProjectEvidence(env: WorkerEnv, input: SemanticRecallRequest,
  identity: SemanticRecallExecutionIdentity): Promise<SemanticRecallResponse> {
  const jsonSchema = semanticRecallSchema(input, identity);
  const result = await runWorkflowAgentNode(env, {
    executionId: identity.executionId, executionFamilyId: identity.executionFamilyId, nodeId: identity.nodeId,
    ownerId: identity.ownerId,
    flowId: identity.flowId, projectId: identity.projectId, workflowKey: null,
    instruction: 'Semantically rank the supplied eligible documents against the query. Read their complete facts. Return results in descending relevance with scores between zero and one. Use only exact supplied document IDs; the candidate scope and model identity are frozen facts. Do not inspect or mutate other resources.',
    outputArtifactType: 'tapcanvas.semantic-ranking/v1', outputEncoding: 'json_object',
    jsonObjectContract: { allowedFields: ['scope', 'results', 'diagnostics'], jsonSchema },
    deliveryRequirement: 'Deliver only the frozen structured semantic-ranking artifact.',
    modelKey: identity.modelKey, maxOutputTokens: 8192, promptMode: 'compact_structured',
    ...(identity.reasoningEffort ? { reasoningEffort: identity.reasoningEffort } : {}),
    inputs: { candidates: [{ scope: input.scope, query: input.query, documents: input.documents }] },
    requiredSkills: [], mountedKnowledgeCardIds: [], disabledSkills: [], disabledKnowledgeCardIds: [],
    allowedTools: [], forcedAgentRole: null, disableRoleSkillBundle: true, resumeOnly: false, previousEvidence: null,
  });
  let output: unknown;
  try { output = JSON.parse(result.text) as unknown; }
  catch (error: unknown) { throw new Error(`semantic_recall_output_json_invalid:${error instanceof Error ? error.message : String(error)}`); }
  return parseSemanticRecallResponse(output, input, identity);
}
