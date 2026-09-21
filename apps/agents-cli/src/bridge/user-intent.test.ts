import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { canonicalUserIntentContractHash, freezeHarnessUserIntent } from './user-intent.js';
import { RequestMcpGateway } from './mcp-gateway.js';
import { isJsonObject, type JsonObject } from './contracts.js';

const contract = (): JsonObject => ({ version: 2, referenceResolution: { mode: 'new_task' },
  delivery: { mode: 'async_artifact', mediaType: 'video', kind: 'complete_video', output: 'Persist the requested film' },
  must: [{ id: 'must:film', statement: 'Generate the requested film', source: 'user', evidence: ['user request'] }],
  forbid: [], prefer: [], confirmedFacts: [], unresolved: [], precedence: ['provider_protocol_limits', 'user_must'] });

test('canonical intent hash uses sorted keys, excludes hashes and nullable prompt discriminator, and has no prefix', () => {
  const value = { b: 2, a: { z: 3, a: 1, contractHash: 'ignored' }, promptMediaType: null, contractHash: 'ignored' };
  const expected = createHash('sha256').update('{"a":{"a":1,"z":3},"b":2}').digest('hex');
  assert.equal(canonicalUserIntentContractHash(value), expected);
});

test('intent correction requires the previous identity and is blocked after execution', () => {
  const first = freezeHarnessUserIntent({ args: { contract: contract() }, previous: null, locked: false });
  assert.ok(first.contract);
  const changed = { ...contract(), unresolved: ['need exact source'] };
  assert.equal(freezeHarnessUserIntent({ args: { contract: changed }, previous: first.contract, locked: false }).contract, null);
  const args = { contract: changed, authoringCorrection: { previousContractHash: first.contract.contractHash, reason: 'Correct the source uncertainty from user evidence' } };
  assert.ok(freezeHarnessUserIntent({ args, previous: first.contract, locked: false }).contract);
  assert.equal(freezeHarnessUserIntent({ args, previous: first.contract, locked: true }).contract, null);
  assert.equal(freezeHarnessUserIntent({ args: { contract: contract() }, previous: null, locked: true }).contract, null);
});

test('MCP forwards the private frozen contract as machine fields and keeps it locked after remote dispatch', async context => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  let body: JsonObject | null = null;
  globalThis.fetch = async (_url, init) => {
    const parsed: unknown = JSON.parse(String(init?.body));
    assert.ok(isJsonObject(parsed)); body = parsed;
    return new Response(JSON.stringify({ acceptedAsync: true, executionId: 'execution' }), { status: 200 });
  };
  const gateway = new RequestMcpGateway();
  const token = gateway.register([{ name: 'authorized_workflow', description: 'Launch workflow', parameters: { type: 'object' } }], [], { endpoint: 'https://api.test/execute' });
  const call = (name: string, args: JsonObject) => gateway.handle(token, `Bearer ${token}`, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  await call('record_user_intent', { contract: contract() });
  const frozen = gateway.userIntentContract(token);
  assert.ok(frozen);
  await call('authorized_workflow', {});
  assert.ok(body);
  assert.deepEqual((body as JsonObject).userIntentContract, frozen);
  assert.equal((body as JsonObject).userIntentContractHash, frozen.contractHash);
  const rejected = await call('record_user_intent', { contract: { ...contract(), unresolved: ['changed'] }, authoringCorrection: { previousContractHash: frozen.contractHash, reason: 'late change' } });
  assert.match(JSON.stringify(rejected), /cannot change after execution/);
  assert.deepEqual(gateway.userIntentContract(token), frozen);
});

test('reads permit intent authoring while premature mutations are blocked without locking repairs', async context => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const dispatched: string[] = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as JsonObject;
    dispatched.push(String(body.toolName));
    return new Response('{}');
  };
  const gateway = new RequestMcpGateway();
  const token = gateway.register([
    { name: 'read', description: 'Read', parameters: {}, execution: { sideEffect: 'none' } },
    { name: 'write', description: 'Write', parameters: {}, execution: { sideEffect: 'local_mutation' } },
  ], [], { endpoint: 'https://api.test/execute' });
  const call = (name: string, args: JsonObject) => gateway.handle(token, `Bearer ${token}`, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  await call('read', {});
  const blocked = await call('write', {});
  assert.match(JSON.stringify(blocked.body), /user_intent_required/);
  assert.deepEqual(dispatched, ['read']);
  await call('record_user_intent', { contract: contract() });
  assert.ok(gateway.userIntentContract(token));
  await call('write', {});
  assert.deepEqual(dispatched, ['read', 'write']);
});
