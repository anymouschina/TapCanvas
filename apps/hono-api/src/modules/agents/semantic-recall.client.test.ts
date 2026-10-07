import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerEnv } from '../../types';
import { runWorkflowAgentNode } from '../execution/execution.agent-runner';
import { parseSemanticRecallResponse, recallProjectEvidence, semanticRecallSchema } from './semantic-recall.client';

vi.mock('../execution/execution.agent-runner', () => ({ runWorkflowAgentNode: vi.fn() }));
const identity = { executionId: 'execution', executionFamilyId: 'execution-family', nodeId: 'image-runtime-node',
  ownerId: 'owner', flowId: 'flow', projectId: 'project', modelKey: 'selected-language-model', reasoningEffort: 'high' as const };
const input = { scope: 'eligible-assets', query: '{"subject":"hero"}',
  documents: [{ id: 'asset-a', text: 'Hero identity' }, { id: 'asset-b', text: 'Other eligible identity' }], limit: 1 };
const output = { scope: input.scope, results: [{ id: 'asset-a', score: 0.9 }],
  diagnostics: { model: identity.modelKey, documents: 2 } };

describe('Agent semantic ranking', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it('freezes candidate identity and rejects model-less execution', () => {
    expect(semanticRecallSchema(input, identity)).toMatchObject({ properties: { results: {
      minItems: 1, maxItems: 1, items: { properties: { id: { enum: ['asset-a', 'asset-b'] } } } } } });
    expect(() => semanticRecallSchema(input, { ...identity, modelKey: '' })).toThrow('execution_identity_required');
    expect(() => semanticRecallSchema({ ...input, documents: [input.documents[0], input.documents[0]] }, identity)).toThrow('input_invalid');
  });
  it('accepts only current scoped candidate receipts with the frozen model', () => {
    expect(parseSemanticRecallResponse(output, input, identity)).toEqual(output);
    expect(() => parseSemanticRecallResponse({ ...output, scope: 'other' }, input, identity)).toThrow('output_contract_invalid');
    expect(() => parseSemanticRecallResponse({ ...output, results: [{ id: 'unscoped', score: 0.9 }] }, input, identity)).toThrow('result_identity_invalid');
  });
  it('uses the existing structured Agent chain without Palace or an embedding service', async () => {
    vi.mocked(runWorkflowAgentNode).mockResolvedValue({ taskId: 'task', text: JSON.stringify(output), assets: [],
      expectedDelivery: null, deliveryEvidence: null, deliveryVerification: null, requestTerminal: null });
    expect(await recallProjectEvidence({} as WorkerEnv, input, identity)).toEqual(output);
    expect(runWorkflowAgentNode).toHaveBeenCalledWith({}, expect.objectContaining({
      executionId: 'execution', executionFamilyId: 'execution-family', nodeId: 'image-runtime-node', ownerId: 'owner', flowId: 'flow',
      projectId: 'project', modelKey: identity.modelKey, reasoningEffort: 'high', outputEncoding: 'json_object', allowedTools: [], requiredSkills: [],
      jsonObjectContract: { allowedFields: ['scope', 'results', 'diagnostics'], jsonSchema: expect.objectContaining({ type: 'object' }) } }));
  });
});
