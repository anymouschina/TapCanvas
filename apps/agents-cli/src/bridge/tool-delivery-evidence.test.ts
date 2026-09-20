import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHarnessDeliveryClosure } from './delivery-contract.js';
import type { RemoteToolExecution } from './mcp-gateway.js';
const execution = (structuredOutput: Record<string, unknown>): RemoteToolExecution => ({ name: 'authorized_tool', args: {}, startedAt: '', finishedAt: '', durationMs: 0, status: 'succeeded', outputText: '', structuredOutput });
const expectedDelivery = { contractHash: 'sha256:contract', must: [{ id: 'video' }], delivery: { mode: 'artifact' } };
const tuple = { expectedDelivery, deliveryEvidence: [{ evidenceId: 'asset', kind: 'asset', attributes: { url: 'https://media.example/video.mp4' } }],
  deliveryVerification: { contractHash: 'sha256:contract', status: 'satisfied', criteria: [{ requirementId: 'video', status: 'satisfied', evidenceIds: ['asset'] }] } };
const close = (structuredOutput: Record<string, unknown>) => buildHarnessDeliveryClosure({ turnContext: { logicalTaskId: 'task', userIntentContract: expectedDelivery }, text: 'result', harnessCompleted: true, remoteExecutions: [execution(structuredOutput)] });

test('only a matching, fully evidence-bound tool verification closes artifact delivery', () => {
  assert.equal(close(tuple).succeeded, true);
  assert.equal(close({ ...tuple, deliveryVerification: { ...tuple.deliveryVerification, contractHash: 'other' } }).succeeded, false);
  assert.equal(close({ ...tuple, deliveryEvidence: [] }).succeeded, false);
  assert.equal(close({ videoUrl: 'https://media.example/video.mp4' }).succeeded, false);
});

test('durable acceptance is waiting, never a terminal delivery or failure', () => {
  const result = close({ protocolVersion: 'tapcanvas.workflow-execution-receipt/v1', executionId: 'exec', status: 'running', acceptedAsync: true, ...tuple });
  assert.equal(result.succeeded, false);
  assert.equal(result.runOutcome.terminal, false);
  assert.equal((result.runtime.physicalRunExit as Record<string, unknown>).kind, 'waiting_external');
});

test('an explicit durable submission boundary completes only the conversation handoff without a continuation', () => {
  const result = close({ protocolVersion: 'tapcanvas.workflow-execution-receipt/v1', executionId: 'exec', status: 'queued',
    acceptedAsync: true, completionBoundary: 'submission', executionOwner: 'durable_executor' });
  assert.equal(result.succeeded, true);
  assert.equal(result.runOutcome.mediaDeliveryStatus, 'pending');
  const exit = result.runtime.physicalRunExit as Record<string, unknown>;
  assert.equal(exit.kind, 'logical_terminal');
  assert.equal(exit.continuationTicket, null);
  assert.equal(result.runtime.terminalDelivery, undefined);
});

test('a newer canceled receipt invalidates an older verified result', () => {
  const base = { protocolVersion: 'tapcanvas.workflow-execution-receipt/v1', executionId: 'exec', terminal: true, acceptedAsync: false };
  const result = buildHarnessDeliveryClosure({ turnContext: { logicalTaskId: 'task', userIntentContract: expectedDelivery }, text: 'result', harnessCompleted: true,
    remoteExecutions: [execution({ ...base, status: 'success', ...tuple }), execution({ ...base, status: 'canceled' })] });
  assert.equal(result.succeeded, false);
});
