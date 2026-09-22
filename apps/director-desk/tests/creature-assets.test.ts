import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { entity, demoProject, assertProject, clone, clip } from '../src/model.ts';
import { CREATURE_ASSETS } from '../src/assets/catalog/creatures.ts';
import { makeActor, animateActor } from '../src/assets/actors.ts';
import { disposeTree } from '../src/assets.ts';
import { assetJoints, isAnimalAsset } from '../src/asset-catalog.ts';
import { mirrorPose } from '../src/assets/joint-schema.ts';
import { applyOperations } from '../src/automation/edits.ts';

test('eight non-quadruped species have finite grounded geometry at declared height and supported joints', () => {
    assert.equal(CREATURE_ASSETS.length, 8);
    for (const asset of CREATURE_ASSETS) {
        const e = entity('actor', asset.id, asset.name), r = makeActor(e);
        assert.ok(isAnimalAsset(e.asset));
        const bounds = new T.Box3().setFromObject(r.root, true);
        assert.ok(Math.abs(bounds.min.y) < 1e-6, asset.id);
        assert.ok(Math.abs(bounds.max.y - e.height) < 1e-6, asset.id);
        r.root.traverse(o => { if (o instanceof T.Mesh) assert.ok([...o.geometry.attributes.position.array].every(Number.isFinite), asset.id); });
        for (const key of Object.keys(assetJoints(e.asset))) assert.ok(key === 'headYaw' || r.joints[key], `${asset.id} ${key}`);
        const head = r.head.getWorldPosition(new T.Vector3());
        assert.ok(Math.abs(head.y - r.headRestHeight! * r.root.scale.y) < 1e-6);
        const p = demoProject(); p.entities.push(e); assertProject(JSON.parse(JSON.stringify(p)));
        disposeTree(r.root);
    }
});

test('animal joint keys are capability checked and invalid edits remain atomic', () => {
    for (const asset of CREATURE_ASSETS) {
        const p = demoProject(), e = entity('actor', asset.id, asset.name); p.entities.push(e);
        const before = clone(p);
        for (const patch of [{ pose: { leftArm: 25 } }, { poseKeys: [{ time: 0, pose: { leftArm: 25 } }] }, { clips: [clip('walk', 0, 2)] }, { footContact: true }])
            assert.throws(() => applyOperations(p, [{ operation: 'update', id: e.id, patch }]));
        assert.deepEqual(p, before);
        const next = applyOperations(p, [{ operation: 'update', id: e.id, patch: { pose: { tail: 30 } } }]);
        assert.equal(next.entities.at(-1)!.pose.tail, 30);
    }
    assert.throws(() => applyOperations(demoProject(), [{ operation: 'add', asset: 'person', patch: { pose: { leftWing: 30 } } }]));
});

test('wings, fins and serpent turns interpolate on correct axes and mirror spatially', () => {
    for (const id of ['animal-eagle', 'animal-fish', 'animal-snake']) {
        const e = entity('actor', id, id), r = makeActor(e);
        const wing = id === 'animal-eagle' ? 'leftWing' : id === 'animal-fish' ? 'leftFin' : 'torso';
        e.poseKeys = [{ time: 0, pose: { [wing]: 0, tail: 0 } }, { time: 2, pose: { [wing]: 60, tail: 20 } }];
        const snapshot = (t: number) => { animateActor(r, e, t); r.root.updateMatrixWorld(true); return Object.values(r.joints).map(j => j.matrixWorld.toArray()); };
        const middle = clone(snapshot(1)); snapshot(2); snapshot(0); assert.deepEqual(snapshot(1), middle);
        const axis = wing === 'torso' ? 'y' : 'z', sign = wing === 'torso' ? 1 : -1;
        assert.ok(Math.abs(r.joints[wing].rotation[axis] - sign * Math.PI / 6) < 1e-9);
        assert.ok(Math.abs(r.joints.tail.rotation.y - Math.PI / 18) < 1e-9);
        e.poseKeys = []; e.pose = { [wing]: 30, tail: 10 };
        const once = mirrorPose(e.pose, wing === 'torso');
        assert.deepEqual(mirrorPose(once, wing === 'torso'), e.pose);
        e.pose = once; animateActor(r, e, 0);
        if (wing !== 'torso') assert.ok(Math.abs(r.joints[wing.replace('left', 'right')].rotation.z - Math.PI / 6) < 1e-9);
        else assert.ok(Math.abs(r.joints.torso.rotation.y + Math.PI / 6) < 1e-9);
        disposeTree(r.root);
    }
});
