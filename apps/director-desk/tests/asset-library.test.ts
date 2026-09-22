import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { ASSETS, searchAssets } from '../src/asset-catalog.ts';
import { entity, demoProject, assertProject, clip, clone } from '../src/model.ts';
import { makeHuman, animateHuman, disposeTree } from '../src/assets.ts';
import { makeHuman as legacyHuman } from '../src/assets/human-legacy.ts';
import { HUMAN_ASSETS } from '../src/assets/catalog/humans.ts';
import { applyOperations } from '../src/automation/edits.ts';
import { colorHuman } from '../src/assets/humanoid.ts';
import { legAngles } from '../src/editor/foot-contact.ts';
import { SHAPE_ASSETS } from '../src/assets/catalog/shapes.ts';
import { makeProp } from '../src/assets.ts';
import { ANIMAL_ASSETS } from '../src/assets/catalog/animals.ts';
import { makeActor, animateActor } from '../src/assets/actors.ts';

test('all human presets share defaults through UI factory and automation, and survive project roundtrip', () => {
    const base = demoProject();
    for (const a of HUMAN_ASSETS) {
        const direct = entity(a.kind, a.id, a.name);
        const edited = applyOperations(base, [{ operation: 'add', asset: a.id }]);
        const added = edited.entities.at(-1)!;
        assert.equal(added.height, direct.height); assert.equal(added.gender, direct.gender);
        assertProject(JSON.parse(JSON.stringify(edited)));
    }
    assert.equal(new Set(ASSETS.map(a => a.id)).size, ASSETS.length);
    assert.equal(searchAssets('GIANT', '特殊人形').length, 2);
    assert.equal(searchAssets('小孩')[0].id, 'human-child');
});

test('new humans stand on the floor at the requested height, with distinct child and dwarf limb proportions', () => {
    for (const a of HUMAN_ASSETS) {
        const e = entity('actor', a.id, a.name), r = makeHuman(e);
        const b = new T.Box3().setFromObject(r.root, true);
        assert.ok(Math.abs(b.min.y) < .00001, `${a.id} foot baseline ${b.min.y}`);
        const headTop = new T.Box3().setFromObject(r.head.children[0], true).max.y;
        assert.ok(Math.abs(headTop - e.height) < .00001, `${a.id} body stature ${headTop}`);
        if (['human-outfit-helmet', 'human-outfit-hat'].includes(a.id)) {
            assert.ok(b.max.y > e.height && b.max.y < e.height + .12, `${a.id} headwear allowance`);
        } else assert.ok(Math.abs(b.max.y - e.height) < .00001, `${a.id} stature ${b.max.y}`);
        assert.ok(r.legLengths!.upper > 0 && r.legLengths!.lower > 0);
        disposeTree(r.root);
    }
    const adult = makeHuman(entity('actor', 'human-adult', 'adult'));
    const dwarf = makeHuman(entity('actor', 'human-dwarf', 'dwarf'));
    assert.ok(dwarf.legLengths!.upper / dwarf.referenceHeight! < adult.legLengths!.upper / adult.referenceHeight! * .8);
    disposeTree(adult.root); disposeTree(dwarf.root);
});

test('legacy asset geometry and rest matrices remain unchanged through the modular entry point', () => {
    for (const asset of ['person', 'woman', 'crowd']) {
        const e = entity(asset === 'crowd' ? 'crowd' : 'actor', asset, asset);
        const old = legacyHuman(e), current = makeHuman(e);
        function geometry(r: ReturnType<typeof makeHuman>) {
            r.root.updateMatrixWorld(true);
            const values: unknown[] = [];
            r.root.traverse(o => { if (o instanceof T.Mesh) values.push({ vertices: [...o.geometry.attributes.position.array], indices: o.geometry.index ? [...o.geometry.index.array] : [], matrix: o.matrixWorld.toArray() }); });
            return values;
        }
        assert.deepEqual(geometry(current), geometry(old));
        assert.equal(current.hips.position.y, .94);
        assert.equal(current.joints.leftKnee.position.y, -.43);
        disposeTree(old.root); disposeTree(current.root);
    }
});

test('different proportion rigs sample deterministically through transitions and pose keys', () => {
    for (const a of HUMAN_ASSETS) {
        const e = entity('actor', a.id, a.name);
        e.clips = [clip('walk', 0, 3), clip('turn', 3, 5), clip('sit', 5, 8)];
        e.poseKeys = [{ time: 0, pose: { head: 5 } }, { time: 8, pose: { head: -10 } }];
        const r = makeHuman(e);
        const snapshot = (t: number) => { animateHuman(r, e, t); r.root.updateMatrixWorld(true); return Object.values(r.joints).map(j => j.matrixWorld.toArray()); };
        const first = clone(snapshot(3.1)); snapshot(7); snapshot(0);
        assert.deepEqual(snapshot(3.1), first);
        assert.ok(first.flat().every(Number.isFinite));
        disposeTree(r.root);
    }
});

test('recoloring affects joints and body while preserving independent instances', () => {
    const a = makeHuman(entity('actor', 'human-adult', 'a')), b = makeHuman(entity('actor', 'human-adult', 'b'));
    const original = b.skin.color.clone(); colorHuman(a, '#f01020');
    assert.ok(b.skin.color.equals(original));
    assert.ok(a.jointSkin!.color.equals(a.skin.color.clone().multiplyScalar(.91)));
    disposeTree(a.root); disposeTree(b.root);
});

test('foot solver respects actual limb lengths for non-adult rigs', () => {
    const upper = .26, lower = .24, angles = legAngles(.38, .10, upper, lower);
    const down = upper * Math.cos(angles.hip) + lower * Math.cos(angles.hip + angles.knee);
    const forward = -upper * Math.sin(angles.hip) - lower * Math.sin(angles.hip + angles.knee);
    assert.ok(Math.abs(down - .38) < 1e-8); assert.ok(Math.abs(forward - .1) < 1e-8);
});

test('shape parameters produce the requested world dimensions with a floor origin', () => {
    for (const asset of SHAPE_ASSETS) {
        const e = entity('prop', asset.id, asset.name);
        e.assetParameters = { width: 2.3, height: 1.7, depth: .8 };
        const p = demoProject(); p.entities.push(e); assertProject(p);
        const root = makeProp(e), bounds = new T.Box3().setFromObject(root, true), size = bounds.getSize(new T.Vector3());
        assert.ok(Math.abs(bounds.min.y) < 1e-6, asset.id);
        [2.3, 1.7, .8].forEach((value, i) => assert.ok(Math.abs(size.getComponent(i) - value) < 1e-5, asset.id));
        disposeTree(root);
    }
});

test('arch and pipe retain real openings instead of solid occluding bounding boxes', () => {
    const arch = makeProp(entity('prop', 'shape-arch', 'arch')); arch.updateMatrixWorld(true);
    const frontRay = new T.Raycaster(new T.Vector3(0, .25, 3), new T.Vector3(0, 0, -1));
    assert.equal(frontRay.intersectObject(arch, true).length, 0);
    frontRay.ray.origin.x = .45; assert.ok(frontRay.intersectObject(arch, true).length > 0);
    const tube = makeProp(entity('prop', 'shape-tube', 'tube')); tube.updateMatrixWorld(true);
    const topRay = new T.Raycaster(new T.Vector3(0, 3, 0), new T.Vector3(0, -1, 0));
    assert.equal(topRay.intersectObject(tube, true).length, 0);
    topRay.ray.origin.x = .45; assert.ok(topRay.intersectObject(tube, true).length > 0);
    disposeTree(arch); disposeTree(tube);
});

test('invalid generic asset parameters reject the entire automation transaction', () => {
    const p = demoProject(), before = clone(p);
    for (const patch of [{ assetParameters: { width: -1 } }, { assetParameters: { imaginary: 1 } }, { assetParameters: { thickness: .8 } }])
        assert.throws(() => applyOperations(p, [{ operation: 'add', asset: 'shape-arch', patch }]));
    assert.throws(() => applyOperations(p, [{ operation: 'add', asset: 'person', patch: { assetParameters: { width: 1 } } }]));
    assert.deepEqual(p, before);
});

test('quadruped assets have grounded, scaled bodies and deterministic independent pose controls', () => {
    for (const asset of ANIMAL_ASSETS) {
        const e = entity('actor', asset.id, asset.name);
        const p = demoProject(); p.entities.push(e); assertProject(p);
        const r = makeActor(e), bounds = new T.Box3().setFromObject(r.root, true);
        assert.ok(Math.abs(bounds.min.y) < 1e-6, asset.id);
        assert.ok(Math.abs(bounds.max.y - e.height) < 1e-6, asset.id);
        e.poseKeys = [{ time: 0, pose: { headYaw: -20, leftArm: 10 } }, { time: 2, pose: { headYaw: 20, leftArm: 0 } }];
        animateActor(r, e, 1); const first = r.head.rotation.toArray();
        animateActor(r, e, 2); animateActor(r, e, 1); assert.deepEqual(r.head.rotation.toArray(), first);
        assert.ok(Math.abs(r.joints.leftArm.rotation.x - T.MathUtils.degToRad(5)) < 1e-8);
        assert.throws(() => applyOperations(p, [{ operation: 'update', id: e.id, patch: { clips: [clip('walk', 0, 2)] } }]));
        assert.throws(() => applyOperations(p, [{ operation: 'update', id: e.id, patch: { footContact: true } }]));
        disposeTree(r.root);
    }
});
