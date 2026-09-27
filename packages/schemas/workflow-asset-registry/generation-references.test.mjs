import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectGenerationReferenceBindings } from './generation-references.mjs';
import { inspectRegisteredAssetPlans } from '../scene-reference-contract/index.mjs';
import { beatSheetAssetPlansSchema } from '../video-authoring-stages/asset-schema.mjs';
import { chapterAssetImageSourceSchema } from '../video-authoring-stages/schema.mjs';

test('full BeatSheet exposes generation references but chapter inner plan cannot redeclare them', () => {
  for (const variant of beatSheetAssetPlansSchema().items.anyOf) assert.ok(variant.properties.referenceAssetBindings);
  const generate = chapterAssetImageSourceSchema.anyOf.find(variant => variant.properties.mode.const === 'generate');
  assert.ok(generate.properties.referenceAssetBindings);
  for (const variant of generate.properties.plan.anyOf) assert.equal(variant.properties.referenceAssetBindings, undefined);
});

test('shared registered-plan inspection validates precise generation input roles and structure', () => {
  const objectRegistry = [{ objectId: 'key', kind: 'prop', name: 'key' }];
  const plan = { objectId: 'key', prompt: 'key image', negativePrompt: 'no text' };
  for (const referenceAssetBindings of [[], [{ assetId: 'old-key', role: 'identity', strength: 0.5 }]]) {
    assert.equal(inspectRegisteredAssetPlans({ objectRegistry, assetPlans: [{ ...plan, referenceAssetBindings }] }), null);
  }
  for (const value of [null, [{ assetId: 'a', role: 'environment' }], [{ assetId: '', role: 'identity' }],
    [{ assetId: 'a', role: 'style', strength: 2 }], [{ assetId: 'a', role: 'style', extra: true }],
    [{ assetId: 'a', role: 'style' }, { assetId: 'a', role: 'identity' }]]) {
    assert.match(inspectGenerationReferenceBindings(value), /referenceAssetBindings/);
    assert.match(inspectRegisteredAssetPlans({ objectRegistry, assetPlans: [{ ...plan, referenceAssetBindings: value }] }), /assetPlans\[0\].referenceAssetBindings/);
  }
});
