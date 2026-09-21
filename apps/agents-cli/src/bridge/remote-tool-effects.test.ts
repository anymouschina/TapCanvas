import test from 'node:test';
import assert from 'node:assert/strict';
import { isReadOnlyRemoteTool } from './remote-tool-effects.js';
import type { RemoteToolDefinition } from './contracts.js';

test('operation-level effects override tool-level effects without inferring from tool names', () => {
  const tool: RemoteToolDefinition = {
    name: 'facade', description: 'Mixed operations', parameters: {}, execution: { sideEffect: 'none' },
    operationExecutions: [
      { selector: { field: 'operation', value: 'read' }, execution: { sideEffect: 'none' } },
      { selector: { field: 'operation', value: 'write' }, execution: { sideEffect: 'local_mutation' } },
    ],
  };
  assert.equal(isReadOnlyRemoteTool(tool, { operation: 'read' }), true);
  assert.equal(isReadOnlyRemoteTool(tool, { operation: 'write' }), false);
  assert.equal(isReadOnlyRemoteTool(tool, { operation: 'unknown' }), false);
  assert.equal(isReadOnlyRemoteTool({ name: 'read', description: 'Read', parameters: {} }, {}), false);
});
