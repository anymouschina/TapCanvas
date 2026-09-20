import { createHash } from 'node:crypto';
import { isJsonObject, type JsonObject, type RemoteToolDefinition } from './contracts.js';
import { validateJsonSchemaStructure, type JsonSchemaStructuralIssue } from './json-schema-structural-validator.js';

export const STRUCTURED_OUTPUT_TOOL = 'submit_structured_output';
export type StructuredSubmission = Readonly<{ value: JsonObject; contractHash: string }>;
const strings = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === 'string') : [];

/** Compile only explicit structural constraints; creative decisions stay with Harness. */
export function structuredOutputSchema(contract: JsonObject): JsonObject {
  const properties: JsonObject = {};
  const required = new Set<string>();
  const field = (name: string, schema: JsonObject): void => {
    properties[name] = { ...(isJsonObject(properties[name]) ? properties[name] : {}), ...schema };
    required.add(name);
  };
  for (const [key, type] of [['requiredStringFields', 'string'], ['requiredNumberFields', 'number'],
    ['requiredObjectFields', 'object'], ['requiredArrayFields', 'array']] as const) {
    for (const name of strings(contract[key])) field(name, { type, ...(type === 'string' ? { minLength: 1 } : {}) });
  }
  if (typeof contract.requiredArrayField === 'string') {
    field(contract.requiredArrayField, { type: 'array', minItems: typeof contract.minimumArrayLength === 'number' ? contract.minimumArrayLength : 1,
      ...(typeof contract.expectedArrayLength === 'number' ? { minItems: contract.expectedArrayLength, maxItems: contract.expectedArrayLength } : {}),
      ...(isJsonObject(contract.itemObject) ? { items: structuredOutputSchema(contract.itemObject) } : {}) });
  }
  for (const [key, constraints] of [['exactStringFields', 'const'], ['exactNumberFields', 'const'],
    ['stringAllowedValues', 'enum']] as const) {
    if (isJsonObject(contract[key])) for (const [name, value] of Object.entries(contract[key])) field(name, { [constraints]: value });
  }
  if (isJsonObject(contract.expectedArrayLengths)) for (const [name, length] of Object.entries(contract.expectedArrayLengths)) {
    field(name, { type: 'array', minItems: length, maxItems: length });
  }
  const arrayItems = (name: string): JsonObject => {
    const array = isJsonObject(properties[name]) ? properties[name] : { type: 'array' };
    const items = isJsonObject(array.items) ? array.items : { type: 'object', properties: {} };
    array.items = items;
    properties[name] = array;
    return items;
  };
  for (const [key, itemKey] of [['arrayItemRequiredStringFields', 'requiredStringFields'],
    ['arrayItemExactStringFields', 'exactStringFields'], ['arrayItemExactNumberFields', 'exactNumberFields'],
    ['arrayItemAllowedFields', 'allowedFields'], ['arrayItemNumberAllowedValues', 'stringAllowedValues']] as const) {
    if (!isJsonObject(contract[key])) continue;
    for (const [name, value] of Object.entries(contract[key])) {
      const items = arrayItems(name);
      const extra = structuredOutputSchema({ [itemKey]: value });
      const existing = isJsonObject(items.properties) ? items.properties : {};
      items.properties = { ...existing, ...(isJsonObject(extra.properties) ? extra.properties : {}) };
      items.required = [...new Set([...strings(items.required), ...strings(extra.required)])];
      if (extra.additionalProperties === false) items.additionalProperties = false;
    }
  }
  const allowed = strings(contract.allowedFields ?? contract.allowedTopLevelFields);
  for (const name of allowed) if (!properties[name]) properties[name] = {};
  const schema: JsonObject = { type: 'object', properties, required: [...required], ...(allowed.length ? { additionalProperties: false } : {}) };
  return isJsonObject(contract.jsonSchema) ? { allOf: [schema, contract.jsonSchema], type: 'object' } : schema;
}

export function structuredOutputTool(contract: JsonObject): RemoteToolDefinition {
  return { name: STRUCTURED_OUTPUT_TOOL,
    description: 'Submit the exact JSON artifact required by this workflow node. Structural failures return actionable issues: repair the candidate and call this tool again in the same Harness turn. After acceptance stop authoring; the Bridge returns the accepted artifact verbatim.',
    parameters: { type: 'object', properties: { output: structuredOutputSchema(contract) }, required: ['output'], additionalProperties: false } };
}

export function inspectStructuredSubmission(contract: JsonObject, value: unknown): {
  submission: StructuredSubmission | null; issues: readonly JsonSchemaStructuralIssue[];
} {
  const issues = validateJsonSchemaStructure({ schema: structuredOutputSchema(contract), value });
  if (!isJsonObject(value) || issues.length) return { submission: null, issues };
  return { submission: { value, contractHash: `sha256:${createHash('sha256').update(JSON.stringify(contract)).digest('hex')}` }, issues };
}
