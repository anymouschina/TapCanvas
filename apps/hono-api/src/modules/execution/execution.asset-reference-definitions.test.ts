import { expect, it } from 'vitest';
import { chapterAssetPlanSchema } from '../../../../../packages/schemas/video-authoring-stages/schema.mjs';
import { compactRepeatedJsonSchemaEnums } from '../../../../../packages/schemas/json-schema-relations/local-references.mjs';
import { validateWorkflowToolArguments } from './execution.json-schema-validator';
import { validateJsonSchemaStructure } from '../../../../agents-cli/src/bridge/json-schema-structural-validator';
import { structuredOutputSchema } from '../../../../agents-cli/src/bridge/structured-output';
import { bindRegisteredAssetReferenceSchema } from './execution.asset-reference-schema';
import { createWorkflowProjectContext } from './execution.project-context';
import { projectNodeAssetsFromCanvases } from '../material/material.project-node-assets';

it('Agent, Hono and provider projection retain the exact large shared enum without reinlining it', () => {
  const ids = Array.from({ length: 853 }, (_, index) => `project-node:chapter:book-${'x'.repeat(40)}:asset-${index}`);
  const reference = { type: 'string', enum: ids };
  const schema = compactRepeatedJsonSchemaEnums({ type: 'object', properties: { a: reference, b: reference, c: reference }, required: ['a','b','c'], additionalProperties: false });
  const outputSchema = structuredOutputSchema({kind:'json',requiredStringFields:[],jsonSchema:schema});
  // $defs remains at the root of the tool's parameter schema, never beneath
  // an invented output envelope that would invalidate #/$defs references.
  const { $defs, ...schemaBody } = schema;
  expect(outputSchema).toMatchObject({ $defs, allOf: expect.arrayContaining([schemaBody]) });
  const wire = outputSchema;
  expect(JSON.stringify(wire).split(ids[852]!).length - 1).toBe(1);
  for (const candidate of [{ a: ids[0], b: ids[852], c: ids[51] }, { a: ids[0], b: 'invented', c: ids[51] }]) {
    const hono = validateWorkflowToolArguments(schema, candidate);
    const agent = validateJsonSchemaStructure({ schema, value: candidate });
    expect(hono.length === 0).toBe(candidate.b !== 'invented');
    expect(agent.length === 0).toBe(candidate.b !== 'invented');
  }
});

it('both validators enforce siblings and fail closed for dangling and cyclic references', () => {
  const schema = { type: 'object', $defs: { selected: { type: 'string', enum: ['aa', 'b'] } },
    properties: { value: { $ref: '#/$defs/selected', minLength: 2 } } };
  for (const value of ['aa', 'b', 'outside']) {
    expect(validateWorkflowToolArguments(schema, {value}).length === 0).toBe(value === 'aa');
    expect(validateJsonSchemaStructure({schema,value:{value}}).length === 0).toBe(value === 'aa');
  }
  for (const invalid of [{ $ref: '#/$defs/absent' }, { $defs: { a: { $ref: '#/$defs/a' } }, $ref: '#/$defs/a' }]) {
    expect(validateWorkflowToolArguments(invalid, {}).length).toBeGreaterThan(0);
    expect(validateJsonSchemaStructure({schema:invalid,value:{}}).some(issue => issue.keyword === '$ref')).toBe(true);
  }
});

it('chapter source schema declares reuse, each generated kind variant and background image source sites', () => {
  const serialized = JSON.stringify(chapterAssetPlanSchema);
  expect(serialized.split('"x-referenceSource":"project_image"').length - 1).toBe(5);
});

it('the real chapter binder shares every permitted ID once across every typed source site', () => {
  const assets = projectNodeAssetsFromCanvases([{ projectId: 'project', ownerType: 'project', ownerId: 'project',
    flowId: 'canvas', canvasRevision: 1, createdAt: '2026-09-20', updatedAt: '2026-09-20',
    data: { nodes: Array.from({length:853}, (_, index) => ({id:`image-${index}`,data:{kind:'image',imageUrl:`https://assets.test/${index}.png`}})), edges: [] } }]);
  const context = createWorkflowProjectContext({projectId:'project',canvasId:'canvas',principalId:'owner',canvasData:{nodes:[],edges:[]},assets});
  const bound = bindRegisteredAssetReferenceSchema(chapterAssetPlanSchema, context);
  const wire = JSON.stringify(bound);
  expect(wire).toContain('x-referenceSource');
  expect(bound).toHaveProperty('x-frozenReferenceCatalogs');
  // Once in the shared enum; unknown facts have no invented/null rows.
  for (const asset of assets) expect(wire.split(JSON.stringify(asset.id)).length - 1).toBe(1);
  const candidate = {objectRegistry:[{objectId:'key',kind:'prop',name:'key',physicalIdentityKey:null,referenceRole:'prop',identityInvariant:'brass',imageSource:{mode:'reuse',assetIds:[assets[852]!.id]}}],backgroundPlans:[{objectId:'space',plan:{assetId:'background',displayName:'space',prompt:'room',negativePrompt:'no letters',referenceAssetBindings:[{assetId:assets[0]!.id,role:'layout'}]}}]};
  expect(validateWorkflowToolArguments(bound,candidate)).toEqual([]);
  expect(validateJsonSchemaStructure({schema:bound,value:candidate})).toEqual([]);
  candidate.objectRegistry[0]!.imageSource.assetIds = ['invented'];
  expect(validateWorkflowToolArguments(bound,candidate).length).toBeGreaterThan(0);
  expect(validateJsonSchemaStructure({schema:bound,value:candidate}).length).toBeGreaterThan(0);
});
