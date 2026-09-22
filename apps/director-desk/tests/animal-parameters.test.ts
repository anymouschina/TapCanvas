import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as T from 'three';
import { ANIMAL_ASSETS } from '../src/assets/catalog/animals.ts';
import { CREATURE_ASSETS } from '../src/assets/catalog/creatures.ts';
import { makeActor, animateActor } from '../src/assets/actors.ts';
import { disposeTree } from '../src/assets.ts';
import { assetParameters } from '../src/assets/parameters.ts';
import { entity, demoProject, assertProject } from '../src/model.ts';
import { applyOperations } from '../src/automation/edits.ts';
import { geometrySignature } from './geometry-signature.ts';
const assets = [...ANIMAL_ASSETS, ...CREATURE_ASSETS];

test('all animal presets preserve their existing geometry with omitted or explicit default ratios', async () => {
    const expected = JSON.parse(await fs.readFile(new URL('./fixtures/animal-default-geometry.json', import.meta.url), 'utf8'));
    for (const asset of assets) {
        const e = entity('actor', asset.id, asset.name), rig = makeActor(e);
        assert.equal(geometrySignature(rig.root), expected[asset.id], asset.id); disposeTree(rig.root);
        e.assetParameters = assetParameters(e); const defaults = makeActor(e);
        assert.equal(geometrySignature(defaults.root), expected[asset.id], asset.id + ' explicit defaults'); disposeTree(defaults.root);
    }
});
test('each advertised animal ratio changes real geometry, remains grounded at stated total height and roundtrips', () => {
    for (const asset of assets) {
        const e = entity('actor', asset.id, asset.name), base = makeActor(e), signature = geometrySignature(base.root); disposeTree(base.root);
        for (const key of Object.keys(asset.parameters!)) {
            e.assetParameters = { [key]: 1.2 }; const project = demoProject(); project.entities.push(e); assertProject(JSON.parse(JSON.stringify(project)));
            const rig = makeActor(e), bounds = new T.Box3().setFromObject(rig.root, true);
            assert.ok(Math.abs(bounds.min.y) < 1e-5, asset.id + ' ' + key + ' floor');
            assert.ok(Math.abs(bounds.max.y - e.height) < 1e-5, asset.id + ' ' + key + ' total height');
            assert.ok(bounds.min.toArray().concat(bounds.max.toArray()).every(Number.isFinite));
            assert.notEqual(geometrySignature(rig.root), signature, asset.id + ' inactive parameter ' + key); disposeTree(rig.root);
        }
    }
});
test('gorilla body and leg combinations keep knuckles and rear feet at the same floor', () => {
    for (const bodyRatio of [.8, 1.2]) for (const legRatio of [.8, 1.2]) {
        const e = entity('actor', 'animal-gorilla', '猩猩'); e.assetParameters = { bodyRatio, legRatio };
        const r = makeActor(e); r.root.updateMatrixWorld(true);
        for (const joint of ['leftElbow', 'rightElbow', 'leftKnee', 'rightKnee']) {
            const foot = r.joints[joint].children.at(-1)!;
            assert.ok(Math.abs(new T.Box3().setFromObject(foot, true).min.y) < 1e-6, joint);
        }
        disposeTree(r.root);
    }
});
test('elephant ear and muzzle controls change the large ear and trunk, not only generic facial pieces', () => {
    const e = entity('actor', 'animal-elephant', '象'); const base = makeActor(e);
    e.assetParameters = { earRatio: 1.2, muzzleRatio: 1.2 }; const changed = makeActor(e);
    const part = (rig: typeof base, name: string) => rig.head.children.find(o => o.userData.animalPart === name) as T.Mesh;
    assert.ok(Math.abs(part(changed, 'ear').scale.y / part(base, 'ear').scale.y - 1.2) < 1e-8);
    const end = (rig: typeof base) => (part(rig, 'trunk').geometry as T.TubeGeometry).parameters.path.getPoint(1);
    assert.ok(end(changed).y < end(base).y - .1); disposeTree(base.root); disposeTree(changed.root);
});
test('adjusted wings, fish fins and snake segments retain deterministic species pose axes', () => {
    for (const id of ['animal-eagle', 'animal-fish', 'animal-snake']) {
        const e = entity('actor', id, id); e.assetParameters = { bodyRatio: 1.2, widthRatio: .8 };
        e.poseKeys = [{ time: 0, pose: { tail: 0 } }, { time: 5, pose: { tail: 25 } }];
        const r = makeActor(e); animateActor(r, e, 3); const first = geometrySignature(r.root); animateActor(r, e, 0); animateActor(r, e, 3);
        assert.equal(geometrySignature(r.root), first); disposeTree(r.root);
    }
    const p = demoProject(), before = JSON.stringify(p);
    assert.throws(() => applyOperations(p, [{ operation: 'add', asset: 'animal-snake', patch: { assetParameters: { legRatio: 1 } } }]));
    assert.throws(() => applyOperations(p, [{ operation: 'add', asset: 'animal-gorilla', patch: { assetParameters: { tailRatio: 1 } } }]));
    assert.equal(JSON.stringify(p), before);
});
