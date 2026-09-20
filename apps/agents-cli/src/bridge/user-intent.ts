import { createHash } from 'node:crypto';
import { isJsonObject, type JsonObject, type RemoteToolDefinition } from './contracts.js';
import { validateJsonSchemaStructure } from './json-schema-structural-validator.js';

export const USER_INTENT_TOOL_NAME = 'record_user_intent';
const requirement = { type: 'object', required: ['id', 'statement', 'source', 'evidence'], additionalProperties: false,
  properties: { id: { type: 'string', minLength: 1 }, statement: { type: 'string', minLength: 1 }, source: { type: 'string', minLength: 1 }, evidence: { type: 'array', items: { type: 'string' } } } };
export const USER_INTENT_SCHEMA: JsonObject = {
  type: 'object', required: ['version', 'referenceResolution', 'delivery', 'must', 'forbid', 'prefer', 'confirmedFacts', 'unresolved', 'precedence'],
  properties: {
    version: { const: 2 }, referenceResolution: { type: 'object' },
    delivery: { type: 'object', required: ['mode', 'mediaType', 'kind', 'output'], properties: {
      mode: { enum: ['response', 'state_change', 'async_artifact'] }, mediaType: { enum: [null, 'image', 'video', 'audio'] },
      kind: { type: 'string', minLength: 1 }, output: { type: 'string', minLength: 1 },
    } },
    must: { type: 'array', minItems: 1, items: requirement }, forbid: { type: 'array', items: requirement },
    prefer: { type: 'array', items: requirement }, confirmedFacts: { type: 'array', items: requirement },
    unresolved: { type: 'array', items: { type: 'string' } }, precedence: { type: 'array', items: { type: 'string' } },
  },
};
export const USER_INTENT_TOOL: RemoteToolDefinition = {
  name: USER_INTENT_TOOL_NAME,
  description: 'Freeze the user intent contract before invoking side-effectful tools. You author semantic intent from actual user instructions and facts; this tool only validates structure and assigns the canonical hash. Preserve the returned contract exactly for later delivery reports. A changed contract requires authoringCorrection with previousContractHash and reason and is forbidden after a remote execution was attempted.',
  parameters: { type: 'object', additionalProperties: false, required: ['contract'], properties: {
    contract: USER_INTENT_SCHEMA,
    authoringCorrection: { type: 'object', additionalProperties: false, required: ['previousContractHash', 'reason'], properties: {
      previousContractHash: { type: 'string', minLength: 1 }, reason: { type: 'string', minLength: 1 },
    } },
  } },
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isJsonObject(value)) return value;
  return Object.fromEntries(Object.keys(value).filter(key => key !== 'contractHash' && !(key === 'promptMediaType' && value[key] === null))
    .sort().map(key => [key, canonicalize(value[key])]));
}
export function canonicalUserIntentContractHash(contract: JsonObject): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(contract))).digest('hex');
}

export function freezeHarnessUserIntent(input: { args: JsonObject; previous: JsonObject | null; locked: boolean }): { contract: JsonObject | null; error: string | null } {
  const issues = validateJsonSchemaStructure({ schema: USER_INTENT_TOOL.parameters, value: input.args });
  const contract = input.args.contract;
  if (issues.length || !isJsonObject(contract)) return { contract: null, error: JSON.stringify({ code: 'user_intent_contract_invalid', issues }) };
  if (!isJsonObject(contract.delivery) || (contract.delivery.mediaType !== null && contract.delivery.mode !== 'async_artifact')) {
    return { contract: null, error: 'Media delivery must use async_artifact mode.' };
  }
  const ids = new Set<string>();
  for (const field of ['must', 'forbid', 'prefer', 'confirmedFacts']) {
    const requirements = contract[field];
    if (!Array.isArray(requirements)) return { contract: null, error: `Invalid requirement collection ${field}.` };
    for (const item of requirements) {
      if (!isJsonObject(item) || typeof item.id !== 'string' || ids.has(item.id)) return { contract: null, error: 'Requirement IDs must be globally unique.' };
      ids.add(item.id);
    }
  }
  const contractHash = canonicalUserIntentContractHash(contract);
  if (input.previous) {
    if (input.previous.contractHash === contractHash) return { contract: input.previous, error: null };
    const correction = input.args.authoringCorrection;
    if (input.locked || !isJsonObject(correction) || correction.previousContractHash !== input.previous.contractHash) {
      return { contract: null, error: 'The frozen contract cannot change after execution or without a matching authoringCorrection.' };
    }
  } else if (input.locked) return { contract: null, error: 'Intent must be frozen before remote execution, not retroactively.' };
  return { contract: { ...structuredClone(contract), contractHash }, error: null };
}
