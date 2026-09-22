import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as T from 'three';
import { HUMAN_ASSETS } from '../src/assets/catalog/humans.ts';
import { HUMAN_RATIO_FIELDS } from '../src/assets/catalog/human-options.ts';
import { assetParameters } from '../src/assets/parameters.ts';
import { makeHuman, animateHuman, disposeTree } from '../src/assets.ts';
import { entity, demoProject, assertProject, clip } from '../src/model.ts';
import { applyOperations } from '../src/automation/edits.ts';
import { geometrySignature } from './geometry-signature.ts';

test('all existing human presets preserve captured geometry and explicit defaults match omitted parameters', async () => {
    const expected = JSON.parse(await fs.readFile(new URL('./fixtures/human-v2-default-geometry.json', import.meta.url), 'utf8'));
    for (const asset of HUMAN_ASSETS) {
        const e = entity('actor', asset.id, asset.name), before = makeHuman(e);
        assert.equal(geometrySignature(before.root), expected[asset.id], asset.id);
        e.assetParameters = assetParameters(e); const after = makeHuman(e);
        assert.equal(geometrySignature(after.root), expected[asset.id], asset.id + ' explicit defaults');
        disposeTree(before.root); disposeTree(after.root);
    }
});
test('independent limb and body ratios keep real stature, floor contact and joints connected across every preset', () => {
    for (const asset of HUMAN_ASSETS) for (const ratio of [.8, 1.2]) {
        const e = entity('actor', asset.id, asset.name);
        e.assetParameters = Object.fromEntries(Object.keys(HUMAN_RATIO_FIELDS).map(key => [key + 'Ratio', ratio]));
        e.assetParameters.thighRatio = ratio === .8 ? 1.2 : .8;
        const project = demoProject(); project.entities.push(e); assertProject(project);
        const rig = makeHuman(e), box = new T.Box3().setFromObject(rig.root, true);
        assert.ok(Math.abs(box.min.y) < 1e-6, asset.id + ' floor');
        assert.ok(Math.abs(new T.Box3().setFromObject(rig.head.children[0], true).max.y - e.height) < 1e-6, asset.id + ' height');
        assert.equal(-rig.joints.leftKnee.position.y, rig.legLengths!.upper);
        assert.equal(-rig.joints.leftAnkle.position.y, rig.legLengths!.lower);
        assert.ok(box.min.toArray().concat(box.max.toArray()).every(Number.isFinite)); disposeTree(rig.root);
    }
    const e = entity('actor', 'human-adult', '独立比例'), base = makeHuman(e);
    e.assetParameters = { thighRatio: 1.2 }; const longer = makeHuman(e);
    assert.equal(longer.legLengths!.upper / base.legLengths!.upper, 1.2); assert.equal(longer.legLengths!.lower, base.legLengths!.lower);
    disposeTree(base.root); disposeTree(longer.root);
});
test('clothing, headwear and backpack compose on every body without changing head/POV reference', () => {
    for (const asset of HUMAN_ASSETS) {
        const e = entity('actor', asset.id, asset.name), before = makeHuman(e);
        e.assetParameters = { outfit: 4, headwear: 1, backpack: 1 };
        const after = makeHuman(e), costumes = new Set<string>();
        after.root.traverse(o => { if (o.userData.costume) costumes.add(o.userData.costume); });
        assert.deepEqual([...costumes].sort(), ['armor', 'backpack', 'helmet']);
        assert.equal(after.referenceHeight, before.referenceHeight); assert.equal(after.headRestHeight, before.headRestHeight);
        assert.equal(after.root.scale.y, before.root.scale.y);
        e.clips = [clip('walk', 0, 2), clip('turn', 2, 4)];
        animateHuman(after, e, 1); const signature = geometrySignature(after.root); animateHuman(after, e, 3); animateHuman(after, e, 1);
        assert.equal(geometrySignature(after.root), signature); disposeTree(before.root); disposeTree(after.root);
    }
});
test('skirt length and garment thickness alter geometry independently and disabled clothes leave no meshes', () => {
    const e = entity('actor', 'human-dwarf', '衣服'), originals = makeHuman(e);
    e.assetParameters = { outfit: 2, outfitLength: 1 }; const long = makeHuman(e);
    e.assetParameters.outfitLength = .5; e.assetParameters.outfitThickness = 2; const short = makeHuman(e);
    const skirt = (r: ReturnType<typeof makeHuman>) => r.joints.leftHip.children.find(o => o.userData.costume === 'dress') as T.Mesh;
    const a = new T.Box3().setFromObject(skirt(long), true).getSize(new T.Vector3()), b = new T.Box3().setFromObject(skirt(short), true).getSize(new T.Vector3());
    assert.ok(Math.abs(b.y / a.y - .5) < 1e-6); assert.ok(b.x > a.x);
    e.assetParameters = { outfit: 0, headwear: 0, backpack: 0 }; const none = makeHuman(e);
    assert.equal(geometrySignature(none.root), geometrySignature(originals.root));
    for (const r of [originals, long, short, none]) disposeTree(r.root);
});
test('parameter edits roundtrip and unsupported combinations reject atomically without changing legacy actors', () => {
    const before = demoProject(), text = JSON.stringify(before);
    const after = applyOperations(before, [{ operation: 'add', asset: 'human-giant', patch: { assetParameters: { outfit: 3, headwear: 2, backpack: 1, shoulderRatio: 1.1 } } }]);
    assertProject(JSON.parse(JSON.stringify(after)));
    for (const parameters of [{ outfit: 99 }, { headwear: .5 }, { thighRatio: 0 }, { outfitThickness: 4 }]) assert.throws(() => applyOperations(before, [{ operation: 'add', asset: 'human-adult', patch: { assetParameters: parameters } }]));
    assert.throws(() => applyOperations(before, [{ operation: 'add', asset: 'person', patch: { assetParameters: { outfit: 1 } } }]));
    assert.equal(JSON.stringify(before), text);
});
