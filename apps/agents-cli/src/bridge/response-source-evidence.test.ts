import test from 'node:test';
import assert from 'node:assert/strict';
import { bindResponseSources, responseSourceEvidence } from './response-source-evidence.js';
import type { RemoteToolExecution } from './mcp-gateway.js';
const receipt = (name: string, status: 'succeeded' | 'failed'): RemoteToolExecution => ({ name, status, args: { path: 'source' }, startedAt: '', finishedAt: '', durationMs: 1, outputText: 'source facts' });
test('a successful non-media read proves the agent-declared source requirement without replay', () => {
  const executions = [receipt('read_project_source', 'succeeded')];
  const result = bindResponseSources([{ id: 'read', requiresToolEvidence: true, sourceEvidenceIds: ['source:0'] }], executions);
  assert.equal(result.error, null);
  assert.deepEqual(result.byRequirement.read, ['source:0']);
  assert.equal(executions.length, 1);
});
test('failed, missing and private self-reports cannot replace source receipts', () => {
  for (const executions of [[], [receipt('read_project_source', 'failed')], [receipt('report_delivery', 'succeeded')]]) {
    assert.deepEqual(responseSourceEvidence(executions), []);
    assert.ok(bindResponseSources([{ id: 'read', requiresToolEvidence: true, sourceEvidenceIds: ['source:0'] }], executions).error);
  }
  assert.ok(bindResponseSources([{ id: 'read', requiresToolEvidence: true }], []).error);
});
test('plain responses remain valid without a source-reading requirement', () => {
  assert.equal(bindResponseSources([{ id: 'answer', statement: 'Explain a concept' }], []).error, null);
});

test('the delivery verifier binds a source criterion to its receipt instead of final prose', async () => {
  const { buildHarnessDeliveryClosure } = await import('./delivery-contract.js');
  const expectedDelivery = { version: 2, contractHash: 'source-contract', delivery: { mode: 'response', mediaType: null, kind: 'answer', output: 'Answer after reading' }, must: [{ id: 'read', statement: 'Read source' }], unresolved: [] };
  const sources = bindResponseSources([{ id: 'read', requiresToolEvidence: true, sourceEvidenceIds: ['source:0'] }], [receipt('read_document', 'succeeded')]);
  const result = buildHarnessDeliveryClosure({ turnContext: { logicalTaskId: 'turn' }, text: 'The source says ...', harnessCompleted: true, remoteExecutions: [receipt('read_document', 'succeeded')],
    deliveryReport: { expectedDelivery, taskSummary: {}, requirementIds: ['read'], successCriteria: ['Read source'], rationale: 'Read and answered',
      sourceEvidence: sources.evidence, sourceEvidenceByRequirement: sources.byRequirement } });
  assert.equal(result.succeeded, true);
  assert.match(JSON.stringify(result.runtime.terminalDelivery), /"evidenceIds":\["source:0"\]/);
});


test('a frozen response contract cannot bypass semantic self-check with final text', async () => {
  const { buildHarnessDeliveryClosure } = await import('./delivery-contract.js');
  const contract = { version: 2, contractHash: 'frozen', delivery: { mode: 'response', mediaType: null, kind: 'answer', output: 'Read then answer' }, must: [{ id: 'read', statement: 'Read source' }], unresolved: [] };
  const input = { turnContext: { logicalTaskId: 'task', userIntentContract: contract }, text: 'Done', harnessCompleted: true };
  assert.equal(buildHarnessDeliveryClosure(input).succeeded, false);
  const sources = bindResponseSources([{ id: 'read', requiresToolEvidence: true, sourceEvidenceIds: ['source:0'] }], [receipt('read', 'succeeded')]);
  const report = { expectedDelivery: contract, taskSummary: {}, requirementIds: ['read'], successCriteria: ['Read'], rationale: 'Checked', sourceEvidence: sources.evidence, sourceEvidenceByRequirement: sources.byRequirement };
  assert.equal(buildHarnessDeliveryClosure({ ...input, deliveryReport: report, remoteExecutions: [receipt('read', 'failed')] }).succeeded, false);
});
