import { expect, it } from 'vitest';
import { inspectStructuredSubmission } from '../../../../agents-cli/src/bridge/structured-output';
import { validateWorkflowAgentOutput } from './execution.agent-output-contract';

const schema = {
  type: 'object',
  properties: { owner: { type: 'string' }, references: { type: 'array', items: { type: 'string' } } },
  required: ['owner', 'references'], additionalProperties: false,
  'x-frozenReferenceFacts': { images: { known: { identity: 'body-a' }, wrong: { identity: 'body-b' }, unknown: { identity: null } } },
  'x-referenceFactEquality': [{ ownerField: 'owner', referencePath: ['references', '*'], catalog: 'images', factField: 'identity', unknownFact: 'observe' }],
};
const contract = { jsonSchema: schema, requiredStringFields: ['owner'], allowedFields: ['owner', 'references'] };
const inspect = (id: string) => {
  const rawText = JSON.stringify({ owner: 'body-a', references: [id] });
  return {
    agent: inspectStructuredSubmission({ kind: 'json', ...contract }, JSON.parse(rawText) as unknown),
    host: validateWorkflowAgentOutput({ encoding: 'json_object', artifactType: 'test/reference', rawText, jsonObjectContract: contract }),
  };
};

it('preserves unknown frozen facts as diagnostics through both delivery contracts', () => {
  const { agent, host } = inspect('unknown');
  expect(agent.submission).not.toBeNull();
  expect(agent.issues).toEqual([]);
  expect(host.ok).toBe(true);
  if (host.ok) expect(host.diagnostics?.some(item => item.message.includes('unverified'))).toBe(true);
});

it('rejects a contradictory frozen identity but accepts exact identity equality', () => {
  expect(inspect('wrong').agent.submission).toBeNull();
  expect(inspect('wrong').host.ok).toBe(false);
  expect(inspect('known').agent.submission).not.toBeNull();
  expect(inspect('known').host.ok).toBe(true);
});
