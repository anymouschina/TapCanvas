import assert from 'node:assert/strict';
import test from 'node:test';
import { RequestMcpGateway } from './mcp-gateway.js';
import { buildHarnessDeliveryClosure } from './delivery-contract.js';
import { inspectStructuredSubmission } from './structured-output.js';

const contract = { kind: 'json', jsonSchema: { type: 'object', required: ['beats'], additionalProperties: false,
  properties: { beats: { type: 'array', minItems: 1, items: { type: 'object', properties: { durationSeconds: { enum: [5, 10] } }, required: ['durationSeconds'], additionalProperties: false } } } } };

test('a rejected structured candidate can be repaired in the same request', async () => {
  const gateway = new RequestMcpGateway();
  const token = gateway.register([], [], null, contract);
  const submit = (output: unknown) => gateway.handle(token, `Bearer ${token}`, {
    jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'submit_structured_output', arguments: { output } },
  });
  const invalid = await submit({ beats: [{ durationSeconds: 9 }] });
  assert.match(JSON.stringify(invalid.body), /structured_output_contract_invalid/);
  assert.equal(gateway.structuredSubmission(token), null);
  await submit({ beats: [{ durationSeconds: 10 }] });
  assert.deepEqual(gateway.structuredSubmission(token)?.value, { beats: [{ durationSeconds: 10 }] });
  assert.deepEqual(gateway.executions(token).map(item => item.status), ['failed', 'succeeded']);
});

test('a completed turn without required artifact receipt is not a completed workflow action', () => {
  const turnContext = { logicalTaskId: 'task', executeForcedAgentDirectly: true, outputContract: contract };
  assert.equal(buildHarnessDeliveryClosure({ turnContext, text: 'done', harnessCompleted: true }).succeeded, false);
  const inspected = inspectStructuredSubmission(contract, { beats: [{ durationSeconds: 5 }] });
  assert.equal(buildHarnessDeliveryClosure({ turnContext, text: 'done', harnessCompleted: true, structuredSubmission: inspected.submission }).succeeded, true);
});

test('legacy transport structural fields still enforce exact lengths and top-level identity', () => {
  const envelope = { requiredArrayField: 'items', expectedArrayLength: 2, allowedTopLevelFields: ['items'] };
  assert.equal(inspectStructuredSubmission(envelope, { items: [{}] }).submission, null);
  assert.equal(inspectStructuredSubmission(envelope, { items: [{}, {}], extra: true }).submission, null);
  assert.ok(inspectStructuredSubmission(envelope, { items: [{}, {}] }).submission);
});
