import { expect, it } from 'vitest';
import { chapterAssetPlanSchema } from '../../../../../packages/schemas/video-authoring-stages/schema.mjs';
import { validateWorkflowToolArguments, findUnsupportedWorkflowToolSchemaKeywords } from './execution.json-schema-validator';
import { sceneReferenceFixture } from './execution.scene-reference-fixture';
import { validateJsonSchemaStructure } from '../../../../agents-cli/src/bridge/json-schema-structural-validator';

const registrySchema = (chapterAssetPlanSchema.properties as Record<string, unknown>).objectRegistry as Record<string, unknown>;
const backgroundPlansSchema = (chapterAssetPlanSchema.properties as Record<string, unknown>).backgroundPlans as Record<string, unknown>;
const base = { objectId: 'one', kind: 'prop', name: '钥匙', physicalIdentityKey: null, referenceRole: 'prop', identityInvariant: '铜钥匙',
  imageSource: { mode: 'reuse', assetIds: ['image-one'] } };

it('rejects source/role contradictions and duplicate object IDs in the author schema', () => {
  expect(findUnsupportedWorkflowToolSchemaKeywords(chapterAssetPlanSchema)).toEqual([]);
  expect(validateWorkflowToolArguments(registrySchema, [base])).toEqual([]);
  for (const item of [{ ...base, referenceRole: 'none' }, { ...base, imageSource: { mode: 'none' } }]) {
    expect(validateWorkflowToolArguments(registrySchema, [item]).length).toBeGreaterThan(0);
  }
  expect(validateWorkflowToolArguments(registrySchema, [{ ...base, referenceRole: 'none', imageSource: { mode: 'none' } }]).length).toBeGreaterThan(0);
  expect(validateWorkflowToolArguments(registrySchema, [base, { ...base, name: '另一个对象' }]))
    .toEqual(expect.arrayContaining([expect.objectContaining({ path: '$[1]', message: expect.stringContaining('duplicates string-field tuple') })]));
});

it('rejects duplicate background plan IDs before clip production while allowing distinct scene states', () => {
  const plan = { objectId: 'ruin-night', plan: {
    assetId: 'background-night', displayName: '夜间废楼', prompt: '夜间无人底图',
    negativePrompt: '无人物', referenceAssetBindings: [],
  } };
  const distinct = { objectId: 'ruin-dawn', plan: { ...plan.plan,
    assetId: 'background-dawn', displayName: '黎明废楼', prompt: '黎明无人底图',
  } };
  expect(validateWorkflowToolArguments(backgroundPlansSchema, [plan, distinct])).toEqual([]);
  const duplicate = [plan, { ...distinct, objectId: plan.objectId }];
  expect(validateWorkflowToolArguments(backgroundPlansSchema, duplicate))
    .toEqual(expect.arrayContaining([expect.objectContaining({ path: '$[1]', message: expect.stringContaining('duplicates string-field tuple') })]));
  expect(validateJsonSchemaStructure({ schema: backgroundPlansSchema, value: duplicate })
    .some(issue => issue.keyword === 'x-uniqueBy' && issue.path === '$[1]')).toBe(true);
});

it('rejects absent character identity and noncharacter body keys before downstream asset preparation', () => {
  expect(validateWorkflowToolArguments(registrySchema, [{ ...base, kind: 'character', physicalIdentityKey: null }]).length).toBeGreaterThan(0);
  expect(validateWorkflowToolArguments(registrySchema, [{ ...base, kind: 'character', physicalIdentityKey: '' }]).length).toBeGreaterThan(0);
  expect(validateWorkflowToolArguments(registrySchema, [{ ...base, physicalIdentityKey: 'body' }]).length).toBeGreaterThan(0);
  expect(validateWorkflowToolArguments(registrySchema, [{ ...base, kind: 'character', physicalIdentityKey: 'body' }])).toEqual([]);
});

it('checks tuple uniqueness and standard JSON uniqueItems with exact generic semantics', () => {
  expect(validateWorkflowToolArguments({ type: 'array', 'x-uniqueBy': ['scope', 'id'] }, [{ scope: 'a', id: '1' }, { scope: 'b', id: '1' }])).toEqual([]);
  expect(validateWorkflowToolArguments({ type: 'array', 'x-uniqueBy': ['id'] }, [{ id: '1' }, { id: '1', title: 'different' }]).length).toBeGreaterThan(0);
  expect(validateWorkflowToolArguments({ type: 'array', uniqueItems: true }, [{ a: 1, b: 2 }, { b: 2, a: 1 }]).length).toBeGreaterThan(0);
  expect(validateWorkflowToolArguments(registrySchema, [{ ...base, imageSource: { mode: 'reuse', assetIds: ['a', 'a'] } }]).length).toBeGreaterThan(0);
});

it('binds generated scene and character plans to their registered kind on both sides of the Agent boundary', () => {
  const genericPlan = { prompt: '空间参考图', negativePrompt: '不改变空间', identityAnchors: ['同一空间'], prohibitedDrift: ['布局不变'] };
  const scene = { ...base, kind: 'scene', referenceRole: 'environment',
    imageSource: { mode: 'generate', referenceAssetBindings: [], plan: {
      sceneCard: sceneReferenceFixture, identityAnchors: ['同一空间'], prohibitedDrift: ['布局不变'],
    } } };
  const cases = [
    { candidate: scene, valid: true },
    { candidate: { ...scene, imageSource: { ...scene.imageSource, plan: genericPlan } }, valid: false },
    { candidate: { ...base, kind: 'character', physicalIdentityKey: 'body', imageSource: { mode: 'generate', referenceAssetBindings: [], plan: genericPlan } }, valid: false },
    { candidate: { ...base, imageSource: { mode: 'generate', referenceAssetBindings: [], plan: genericPlan } }, valid: true },
  ];
  for (const { candidate, valid } of cases) {
    expect(validateWorkflowToolArguments(registrySchema, [candidate]).length === 0).toBe(valid);
    expect(validateJsonSchemaStructure({ schema: registrySchema, value: [candidate] }).length === 0).toBe(valid);
  }
});
