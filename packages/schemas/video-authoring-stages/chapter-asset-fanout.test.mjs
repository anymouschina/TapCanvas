import assert from 'node:assert/strict';
import test from 'node:test';
import { chapterAssetPlanSchema } from './schema.mjs';
import {
  CHAPTER_ASSET_BACKGROUND_KIND, CHAPTER_ASSET_OBJECT_KINDS, CHAPTER_ASSET_OUTLINE_LISTED_KINDS,
  bindChapterAssetPartSchema, chapterAssetOutlineSchema,
  mergeChapterAssetParts, seedsFromOutline,
} from './chapter-asset-fanout.mjs';

const outline = {
  palette: { name: '夏夜灯火色彩锚点', brief: '灯笼暖光与深青夜色' },
  scenes: [
    { name: '客栈门前长街', brief: '主场景', backgrounds: [
      { name: '长街·月夜俯视空场底图', brief: '全景调度镜头' },
      { name: '长街·月夜平视空场底图', brief: '对峙与近景镜头' },
    ] },
  ],
  objects: [
    { name: '叶行歌', kind: 'character', brief: '主角' },
    { name: '提灯', kind: 'prop', brief: '长街照明道具' },
  ],
};

test('object kinds mirror the canonical registry enum', () => {
  const variantKinds = chapterAssetPlanSchema.properties.objectRegistry.items.anyOf[0].properties.kind.enum;
  assert.deepEqual([...CHAPTER_ASSET_OBJECT_KINDS], variantKinds);
});

test('seeds get stable host-assigned identities: palette, scenes, then listed objects; backgrounds follow their scene', () => {
  const seeds = seedsFromOutline({ text: JSON.stringify(outline) });
  assert.deepEqual(seeds.map(seed => seed.objectId), ['obj-01', 'obj-02', 'obj-03', 'obj-04', 'bg-01', 'bg-02']);
  assert.deepEqual(seeds.map(seed => seed.kind), ['palette', 'scene', 'character', 'prop', CHAPTER_ASSET_BACKGROUND_KIND, CHAPTER_ASSET_BACKGROUND_KIND]);
  assert.deepEqual(seeds.filter(seed => seed.kind === CHAPTER_ASSET_BACKGROUND_KIND).map(seed => seed.sceneObjectId), ['obj-02', 'obj-02']);
  assert.equal(seeds[0].outlineId, seeds[0].objectId);
});

// 防退化：2026-10-01 改成扇出后，大纲只列角色/主场景/道具，色卡与回忆地点的场景对象整体消失。
// 这些是结构不变量，不依赖作者是否想起来。
test('every registry kind can be produced by the outline, and palette and scene have mandatory slots', () => {
  const reachable = new Set(['palette', 'scene', ...chapterAssetOutlineSchema.properties.objects.items.properties.kind.enum]);
  assert.deepEqual([...reachable].sort(), [...CHAPTER_ASSET_OBJECT_KINDS].sort());
  assert.deepEqual(chapterAssetOutlineSchema.properties.objects.items.properties.kind.enum, [...CHAPTER_ASSET_OUTLINE_LISTED_KINDS]);
  assert.deepEqual(chapterAssetOutlineSchema.required, ['palette', 'scenes', 'objects']);
  assert.equal(chapterAssetOutlineSchema.properties.scenes.minItems, 1);
  assert.equal(chapterAssetOutlineSchema.properties.scenes.items.properties.backgrounds.minItems, 1);
});

test('any valid outline yields exactly one palette, and every background belongs to a scene seed', () => {
  const twoLocations = { ...outline, scenes: [...outline.scenes, { name: '顾氏医馆', brief: '回忆地点', backgrounds: [{ name: '医馆·平视空场底图', brief: '回忆镜头' }] }] };
  const seeds = seedsFromOutline(twoLocations);
  assert.equal(seeds.filter(seed => seed.kind === 'palette').length, 1);
  const sceneIds = new Set(seeds.filter(seed => seed.kind === 'scene').map(seed => seed.objectId));
  assert.equal(sceneIds.size, 2);
  const backgrounds = seeds.filter(seed => seed.kind === CHAPTER_ASSET_BACKGROUND_KIND);
  assert.ok(backgrounds.every(seed => sceneIds.has(seed.sceneObjectId)));
  assert.deepEqual(new Set(backgrounds.map(seed => seed.sceneObjectId)), sceneIds, 'every scene has at least one background');
});

test('outline validation reports exact problems', () => {
  const many = (count, make) => Array.from({ length: count }, (_, i) => make(i));
  assert.throws(() => seedsFromOutline({ ...outline, palette: undefined }), /palette must be an object/);
  assert.throws(() => seedsFromOutline({ ...outline, scenes: [] }), /scenes must be a non-empty array/);
  assert.throws(() => seedsFromOutline({ ...outline, scenes: [{ name: '长街', brief: 'x', backgrounds: [] }] }), /backgrounds must be a non-empty array/);
  assert.throws(() => seedsFromOutline({ ...outline, objects: [{ name: 'a', kind: 'weapon', brief: 'x' }] }), /kind must be one of/);
  assert.throws(() => seedsFromOutline({ ...outline, objects: [{ name: '酒楼', kind: 'scene', brief: 'x' }] }), /kind must be one of/);
  assert.throws(() => seedsFromOutline({ ...outline, objects: [{ name: '色卡', kind: 'palette', brief: 'x' }] }), /kind must be one of/);
  assert.throws(() => seedsFromOutline({ ...outline, objects: [{ name: 'a', kind: 'prop', brief: 'x' }, { name: 'a', kind: 'prop', brief: 'y' }] }), /names must be unique/);
  assert.throws(() => seedsFromOutline({ ...outline, objects: [{ name: '客栈门前长街', kind: 'prop', brief: 'x' }] }), /names must be unique/);
  // Counts are the author's call; the provider limits what it accepts (ch1: 7 base images over 5 locations).
  assert.equal(seedsFromOutline({ ...outline, objects: many(20, i => ({ name: `n${i}`, kind: 'prop', brief: 'x' })) }).length, 1 + outline.scenes.length + 20 + outline.scenes.reduce((n, scene) => n + scene.backgrounds.length, 0));
  assert.equal(seedsFromOutline({ ...outline, scenes: [{ name: 's', brief: 'x', backgrounds: many(9, i => ({ name: `b${i}`, brief: 'x' })) }] }).filter(seed => seed.kind === 'background').length, 9);
  assert.throws(() => seedsFromOutline({ ...outline, scenes: [{ name: 's', brief: 'x', backgrounds: [{ name: 'b', brief: 'x' }, { name: 'b', brief: 'y' }] }] }), /background names must be unique/);
  assert.throws(() => seedsFromOutline('{not json'), /not valid JSON/);
});

test('the outline schema forbids extra fields and leaves list sizes to the author', () => {
  assert.equal(chapterAssetOutlineSchema.additionalProperties, false);
  assert.equal(chapterAssetOutlineSchema.properties.objects.maxItems, undefined);
  assert.equal(chapterAssetOutlineSchema.properties.scenes.maxItems, undefined);
  assert.equal(chapterAssetOutlineSchema.properties.scenes.items.properties.backgrounds.maxItems, undefined);
});

test('part schemas pin identity per seed kind and never mutate the shared schema', () => {
  const before = JSON.stringify(chapterAssetPlanSchema);
  const [palette, scene, character, prop, background] = seedsFromOutline(outline);
  const sceneSchema = bindChapterAssetPartSchema(scene);
  assert.equal(JSON.stringify(chapterAssetPlanSchema), before, 'binding must not mutate the shared schema');
  assert.equal(sceneSchema.properties.objectRegistry.minItems, 1);
  assert.equal(sceneSchema.properties.objectRegistry.maxItems, 1);
  assert.equal(sceneSchema.properties.backgroundPlans.maxItems, 0, 'objects never carry background plans');
  assert.deepEqual(sceneSchema.properties.objectRegistry.items.allOf.at(-1).properties,
    { objectId: { const: 'obj-02' }, kind: { const: 'scene' }, name: { const: '客栈门前长街' } });
  assert.deepEqual(bindChapterAssetPartSchema(palette).properties.objectRegistry.items.allOf.at(-1).properties.kind, { const: 'palette' });
  assert.equal(bindChapterAssetPartSchema(character).properties.backgroundPlans.maxItems, 0);
  assert.equal(bindChapterAssetPartSchema(prop).properties.objectRegistry.maxItems, 1);
  const backgroundSchema = bindChapterAssetPartSchema(background);
  assert.equal(backgroundSchema.properties.objectRegistry.maxItems, 0, 'backgrounds never carry registry entries');
  assert.equal(backgroundSchema.properties.backgroundPlans.minItems, 1);
  assert.equal(backgroundSchema.properties.backgroundPlans.maxItems, 1);
  assert.deepEqual(backgroundSchema.properties.backgroundPlans.items.properties.objectId, { const: 'bg-01' });
  assert.deepEqual(backgroundSchema.properties.backgroundPlans.items.properties.plan.properties.assetId, { const: 'bg-01' });
  assert.throws(() => bindChapterAssetPartSchema({ objectId: '', kind: 'prop', name: 'x' }), /frozen seed/);
  assert.throws(() => bindChapterAssetPartSchema({ objectId: 'x', kind: 'weapon', name: 'x' }), /frozen seed/);
});

const objectPart = seed => ({ objectRegistry: [{ objectId: seed.objectId, kind: seed.kind, name: seed.name }], backgroundPlans: [] });
const backgroundPart = seed => ({ objectRegistry: [], backgroundPlans: [{ objectId: seed.objectId, plan: { assetId: seed.objectId } }] });
const partFor = seed => ({ text: JSON.stringify(seed.kind === CHAPTER_ASSET_BACKGROUND_KIND ? backgroundPart(seed) : objectPart(seed)) });

test('merge concatenates parts in seed order; backgrounds are independent of scene objects', () => {
  const seeds = seedsFromOutline(outline);
  const merged = mergeChapterAssetParts(seeds, seeds.map(partFor));
  assert.deepEqual(merged.objectRegistry.map(entry => entry.objectId), ['obj-01', 'obj-02', 'obj-03', 'obj-04']);
  assert.deepEqual(merged.backgroundPlans.map(plan => plan.objectId), ['bg-01', 'bg-02']);
});

test('merge rejects identity drift, wrong counts and misplaced entries', () => {
  const seeds = seedsFromOutline(outline);
  const good = seeds.map(seed => JSON.parse(partFor(seed).text));
  const run = parts => mergeChapterAssetParts(seeds, parts);
  assert.throws(() => run(good.slice(0, 5)), /part count/);
  const drift = structuredClone(good); drift[0].objectRegistry[0].name = '别人';
  assert.throws(() => run(drift), /differs from the frozen seed/);
  const two = structuredClone(good); two[3].objectRegistry.push(two[3].objectRegistry[0]);
  assert.throws(() => run(two), /exactly one objectRegistry/);
  const misplaced = structuredClone(good); misplaced[0].backgroundPlans = [{ objectId: 'obj-01', plan: {} }];
  assert.throws(() => run(misplaced), /must not carry backgroundPlans/);
  const bgWithEntry = structuredClone(good); bgWithEntry[4].objectRegistry = [{ objectId: 'x', kind: 'prop', name: 'x' }];
  assert.throws(() => run(bgWithEntry), /must not carry objectRegistry/);
  const bgForeign = structuredClone(good); bgForeign[5].backgroundPlans[0].objectId = 'bg-99';
  assert.throws(() => run(bgForeign), /background identity differs/);
  const bgNone = structuredClone(good); bgNone[4].backgroundPlans = [];
  assert.throws(() => run(bgNone), /exactly one backgroundPlans/);
});
