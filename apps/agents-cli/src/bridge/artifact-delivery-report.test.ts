import test from 'node:test';
import assert from 'node:assert/strict';
import { deliveryEvidenceCatalog, inspectArtifactDeliveryReport } from './artifact-delivery-report.js';
import type { RemoteToolExecution } from './mcp-gateway.js';
const receipt = { protocolVersion: 'tapcanvas.workflow-execution-receipt/v1', terminal: true, status: 'success', acceptedAsync: false,
  executionId: 'exec', workflowOutputs: [{ ports: { output: { video: ['https://assets.example/movie.mp4'] } } }] };
const executions: RemoteToolExecution[] = [{ name: 'inspect', args: {}, status: 'succeeded', startedAt: '', finishedAt: '', durationMs: 0, outputText: '', structuredOutput: receipt }];
const frozenContract = { version: 2, contractHash: 'hash', delivery: { mode: 'artifact', mediaType: 'video' }, must: [{ id: 'final', statement: 'Complete requested film' }] };
const args = () => ({ expectedDelivery: frozenContract, criteria: [{ requirementId: 'final', evidenceIds: [deliveryEvidenceCatalog(executions)[0]!.evidenceId], rationale: 'The terminal output is the requested complete film after checking source coverage.' }], rationale: 'Checked user scope against full terminal output.' });

test('agent semantic mapping must cite real terminal evidence for all frozen criteria', () => {
  assert.ok(inspectArtifactDeliveryReport({ args: args(), frozenContract, executions }).delivery);
  assert.equal(inspectArtifactDeliveryReport({ args: { ...args(), criteria: [{ requirementId: 'final', evidenceIds: ['invented'], rationale: 'done' }] }, frozenContract, executions }).delivery, null);
  assert.equal(inspectArtifactDeliveryReport({ args: { ...args(), expectedDelivery: { ...frozenContract, must: [] } }, frozenContract, executions }).delivery, null);
});

test('pending receipt and text-only output cannot fulfill media artifact self-check', () => {
  const pending = [{ ...executions[0]!, structuredOutput: { ...receipt, terminal: false, status: 'running', acceptedAsync: true } }];
  assert.deepEqual(deliveryEvidenceCatalog(pending), []);
  assert.equal(inspectArtifactDeliveryReport({ args: args(), frozenContract, executions: pending }).delivery, null);
  const text = [{ ...executions[0]!, structuredOutput: { ...receipt, workflowOutputs: [{ ports: { output: { text: ['all done'] } } }] } }];
  const evidence = deliveryEvidenceCatalog(text)[0]!;
  assert.equal(inspectArtifactDeliveryReport({ args: { ...args(), criteria: [{ requirementId: 'final', evidenceIds: [evidence.evidenceId], rationale: 'done' }] }, frozenContract, executions: text }).delivery, null);
});

test('only the latest receipt for an execution can supply artifact evidence', () => {
  for (const status of ['failed', 'canceled', 'running']) {
    const updated = [...executions, { ...executions[0]!, structuredOutput: { ...receipt, status, terminal: status !== 'running', acceptedAsync: status === 'running' } }];
    assert.deepEqual(deliveryEvidenceCatalog(updated), []);
    assert.equal(inspectArtifactDeliveryReport({ args: args(), frozenContract, executions: updated }).delivery, null);
  }
});
