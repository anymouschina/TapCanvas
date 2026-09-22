import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { entity, type Entity } from '../src/model.ts';
import { makeHuman } from '../src/assets/humanoid.ts';
import { builtinHumanoidSkeleton } from '../src/animation/builtin-humanoid.ts';
import { FootGrounding, solveHumanoidLeg } from '../src/animation/foot-grounding.ts';
import { humanoidJointTransform } from '../src/animation/humanoid-retarget.ts';
import { geometryBounds } from '../src/spatial/geometry.ts';
import { footSurfaceQuery } from '../src/animation/contact-surfaces.ts';
import { applyOperations, applyOperationsWithResources } from '../src/automation/edits.ts';
import { createScene } from '../src/scenes.ts';
const close = (a: number, b: number, epsilon = 1e-7) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
function fixture(asset = 'human-adult') {
    const e: Entity = entity('actor', asset, 'test');
    const rig = makeHuman(e), skeleton = builtinHumanoidSkeleton(rig, e);
    return { e, rig, skeleton };
}
test('3D leg solve keeps bone lengths, incoming knee plane and foot orientation across body proportions', () => {
    for (const asset of ['person', 'human-adult', 'human-dwarf', 'human-giant']) {
        const { skeleton: s } = fixture(asset), at = (key: 'leftUpperLeg' | 'leftLowerLeg' | 'leftFoot') => humanoidJointTransform(s.bones[key]!, s.frame);
        s.bones.leftLowerLeg!.rotation.x = .2;
        const hip = at('leftUpperLeg'), knee = at('leftLowerLeg'), ankle = at('leftFoot');
        const upper = hip.position.distanceTo(knee.position), lower = knee.position.distanceTo(ankle.position);
        const goal = hip.position.clone().add(new T.Vector3(.12, -.65, .24).normalize().multiplyScalar((upper + lower) * .8));
        const offsets = Object.values(s.bones).map(n => n.position.toArray());
        assert.equal(solveHumanoidLeg(s, 'left', goal), true); close(at('leftFoot').position.distanceTo(goal), 0);
        close(at('leftUpperLeg').position.distanceTo(at('leftLowerLeg').position), upper);
        close(at('leftLowerLeg').position.distanceTo(at('leftFoot').position), lower);
        close(1 - Math.abs(at('leftFoot').rotation.dot(ankle.rotation)), 0);
        assert.deepEqual(Object.values(s.bones).map(n => n.position.toArray()), offsets);
        assert.equal(solveHumanoidLeg(s, 'left', hip.position.clone().add(new T.Vector3(0, -100, 0))), false);
    }
});
test('foot vertices rise out of a floor without pulling a lifted foot down, with independent tilted/scaled placement', () => {
    for (const asset of ['person', 'human-adult', 'human-dwarf', 'human-giant']) {
        const { skeleton: s } = fixture(asset), grounding = new FootGrounding(s);
        s.frame.position.set(5, -.06, -3); s.frame.rotation.y = .7; s.frame.scale.set(1.3, .9, 1.1);
        s.frame.updateMatrixWorld(true);
        const before = geometryBounds(s.bones.leftFoot!)!.min.y; assert.ok(before < 0);
        const result = grounding.apply({ mode: 'preventPenetration', maxCorrection: .2 }, () => 0);
        assert.ok(result.feet.every(f => f.status === 'corrected'), JSON.stringify(result));
        for (const side of ['left', 'right'] as const) close(geometryBounds(s.bones[`${side}Foot`]!)!.min.y, 0, 1e-6);
        s.resetReference(); s.frame.position.y = .25; s.frame.updateMatrixWorld(true);
        const rotations = Object.values(s.bones).map(n => n.quaternion.toArray());
        const lifted = grounding.apply({ mode: 'preventPenetration', maxCorrection: .4 }, () => 0);
        assert.ok(lifted.feet.every(f => f.status === 'clear')); assert.deepEqual(Object.values(s.bones).map(n => n.quaternion.toArray()), rotations);
        const missing = grounding.apply({ mode: 'preventPenetration', maxCorrection: .01 }, () => null);
        assert.ok(missing.feet.every(f => f.status === 'no-surface'));
    }
});
test('surface sampling uses actual prop tops, respects reach and does not mistake downward faces for supports', () => {
    const platform = new T.Mesh(new T.BoxGeometry(2, .2, 2), new T.MeshBasicMaterial()); platform.position.y = .3; platform.updateMatrixWorld(true);
    const query = footSurfaceQuery([platform]); close(query(new T.Vector3(0, .3, 0), .2)!, .4);
    assert.equal(query(new T.Vector3(0, 3, 0), .2), null); close(query(new T.Vector3(3, -.02, 0), .1)!, 0);
});
test('bounded world-vertical pelvis lift preserves incoming leg rotations and authored placement when sufficient', () => {
    for (const asset of ['person', 'human-adult', 'human-dwarf', 'human-giant']) {
        const { skeleton: s } = fixture(asset), grounding = new FootGrounding(s);
        s.frame.position.set(3, -.09, 2); s.frame.rotation.set(.08, .5, -.04); s.frame.scale.set(1.3, .9, 1.1); s.frame.updateMatrixWorld(true);
        const before = Object.values(s.bones).map(n => n.quaternion.toArray()), root = s.frame.matrixWorld.clone(), hip = s.bones.hips!.getWorldPosition(new T.Vector3());
        const result = grounding.apply({ mode: 'preventPenetration', maxCorrection: .4, maxPelvisLift: .4 }, () => 0);
        assert.ok(result.pelvis!.lift > 0); assert.deepEqual(Object.values(s.bones).map(n => n.quaternion.toArray()), before);
        assert.deepEqual(s.frame.matrixWorld.elements, root.elements);
        const after = s.bones.hips!.getWorldPosition(new T.Vector3()); close(after.x, hip.x); close(after.z, hip.z); close(after.y - hip.y, result.pelvis!.lift);
        assert.ok(result.feet.every(f => f.residual < 1e-6));
        s.resetReference(); s.frame.updateMatrixWorld(true);
        const limited = grounding.apply({ mode: 'preventPenetration', maxCorrection: .4, maxPelvisLift: .02 }, () => 0);
        close(limited.pelvis!.lift, .02); assert.ok(limited.feet.every(f => f.residual < 1e-6));
        assert.notDeepEqual(Object.values(s.bones).map(n => n.quaternion.toArray()), before);
        s.resetReference(); s.frame.position.y = 1; s.frame.updateMatrixWorld(true);
        const clear = grounding.apply({ mode: 'preventPenetration', maxCorrection: .4, maxPelvisLift: .4 }, () => 0); close(clear.pelvis!.lift, 0);
    }
});
test('invalid grounding options reject the entire AI/offline transaction', async () => {
    const p = await applyOperationsWithResources(createScene('blank'), [{ operation: 'add', id: 'a', asset: 'human-adult' }, { operation: 'motion', id: 'a', asset: 'human-walk-v1', time: 0 }]);
    const before = JSON.stringify(p), clip = p.entities.find(e => e.id === 'a')!.clips[0];
    for (const value of [false, { mode: 'feet', maxCorrection: .1 }, { mode: 'preventPenetration', maxCorrection: 0 }, { mode: 'preventPenetration', maxCorrection: 3 }, { mode: 'preventPenetration', maxCorrection: .1, unused: true }]) {
        const c = structuredClone(clip); Object.assign(c.retarget!, { grounding: value });
        assert.throws(() => applyOperations(p, [{ operation: 'update', id: 'a', patch: { clips: [c] } }]));
    }
    for (const maxPelvisLift of [-1, 3, NaN, '0.1']) {
        const c = structuredClone(clip); Object.assign(c.retarget!, { grounding: { mode: 'preventPenetration', maxCorrection: .2, maxPelvisLift } });
        assert.throws(() => applyOperations(p, [{ operation: 'update', id: 'a', patch: { clips: [c] } }]));
    }
    assert.equal(JSON.stringify(p), before);
});
