import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { adoptModel } from '../src/resources/model-runtime.ts';
import { ModelMotion } from '../src/resources/model-motion.ts';
import { assertNativeBindings, assertNativeClip, nativeSample } from '../src/resources/native-animation.ts';
import { entity, type Clip } from '../src/model.ts';
import { sliceAction } from '../src/clip-editing.ts';
import { geometryBounds } from '../src/spatial/geometry.ts';

function fixture() {
    const scene = new T.Group(), hips = new T.Bone(), hand = new T.Bone(); hips.name = 'hips'; hand.name = 'hand'; hips.position.z = 1; hand.position.x = 1; hips.add(hand); scene.add(hips);
    const geometry = new T.BufferGeometry(); geometry.setAttribute('position', new T.Float32BufferAttribute([0, 0, 1, .5, 0, 1, 0, .5, 1], 3));
    geometry.setAttribute('skinIndex', new T.Uint16BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 4)); geometry.setAttribute('skinWeight', new T.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
    const mesh = new T.SkinnedMesh(geometry, new T.MeshBasicMaterial()); scene.add(mesh); scene.updateMatrixWorld(true); mesh.bind(new T.Skeleton([hips, hand]));
    const q = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), Math.PI / 2);
    const animations = [new T.AnimationClip('move', 2, [new T.VectorKeyframeTrack('hips.position', [0, 2], [0, 0, 1, 2, 4, 2]), new T.QuaternionKeyframeTrack('hand.quaternion', [0, 2], [0, 0, 0, 1, ...q.toArray()])]),
        new T.AnimationClip('other', 2, [new T.VectorKeyframeTrack('hips.position', [0, 2], [3, 1, 1, 7, 8, 2])])];
    return adoptModel({ scene, scenes: [scene], cameras: [], animations }, '', []);
}
const close = (actual: number[], expected: number[]) => actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-8, `${actual} != ${expected}`));
const motion = { mode: 'inPlace' as const, node: '0/0' };

test('horizontal root removal respects source up-axis, units, entity rotation/scale and keeps vertical motion and skin', () => {
    const source = fixture(), a = source.instantiate(), frame = new T.Group(), control = new ModelMotion(a); frame.add(control.root);
    a.root.rotation.x = -Math.PI / 2; a.root.scale.setScalar(2); a.root.position.set(-3, 0, 4);
    frame.position.set(10, 1, 20); frame.rotation.y = Math.PI / 2; frame.scale.setScalar(3);
    control.sample(0, 0, false, motion); const first = a.bonePosition('0/0').toArray(); close(first, [22, 7, 29]);
    control.sample(0, 2, false, motion); close(a.bonePosition('0/0').toArray(), [22, 13, 29]);
    close(control.state()!.removedWorld, [-24, 0, -12]);
    const skin = geometryBounds(control.root)!; assert.ok(skin.min.y >= 13 - 1e-7 && skin.max.y <= 13 + 1e-7, 'skin must receive the same calibrated vertical translation');
    let animatedHand: T.Object3D | undefined; a.root.traverse(n => { if (n.name === 'hand') animatedHand = n; });
    assert.ok(animatedHand!.quaternion.clone().normalize().angleTo(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), Math.PI / 2)) < 1e-8, 'limb rotation remains untouched');
    control.sample(0, 2, false); close(a.bonePosition('0/0').toArray(), [-2, 13, 17]); assert.equal(control.state(), null);
    control.reset(); a.setDefaultPose(); close(a.bonePosition('0/0').toArray(), first); source.dispose();
});

test('source reference is deterministic across loops, split clips, arbitrary first seeks and calibration edits', () => {
    const source = fixture(), a = source.instantiate(), b = source.instantiate(), ca = new ModelMotion(a), cb = new ModelMotion(b);
    const frame = new T.Group(); frame.add(ca.root, cb.root); a.root.rotation.x = b.root.rotation.x = -Math.PI / 2;
    const actor = entity('actor', 'external-model', 'figure');
    const clip: Clip = { id: 'motion', action: 'native', native: { index: 0, loop: true, motion }, start: 1, end: 5, speed: 1.3, offset: .2 }; actor.clips = [clip];
    const sample = (time: number) => { const at = nativeSample(actor, time)!; ca.sample(at.index, at.time, at.loop, at.motion); return a.bonePosition('0/0').toArray(); };
    const query = nativeSample(actor, 1)!; query.motion!.node = '0'; assert.equal(actor.clips[0].native!.motion!.node, '0/0');
    const times = [1, 1.5, 2, 3, 4.5], expected = times.map(sample);
    actor.clips = [sliceAction(clip, 1, 2), sliceAction(clip, 2, 5)]; times.forEach((time, i) => close(sample(time), expected[i]));
    cb.sample(0, 1.75, true, motion); sample(3); cb.sample(0, .2, true, motion); sample(1); close(b.bonePosition('0/0').toArray(), a.bonePosition('0/0').toArray());
    a.root.scale.setScalar(4); a.root.rotation.x = 0; a.root.position.set(1, 2, 3); ca.sample(0, 1, false, motion); close(a.bonePosition('0/0').toArray(), [1, 10, 7]);
    ca.sample(1, 2, false, motion); close(a.bonePosition('0/0').toArray(), [13, 34, 7]);
    ca.sample(0, 0, true, motion); close(a.bonePosition('0/0').toArray(), [1, 2, 7]);
    source.dispose();
});

test('source node descriptors and validation work for non-bone animation roots without inventing a humanoid rig', () => {
    const scene = new T.Group(), mover = new T.Group(), mesh = new T.Mesh(new T.BoxGeometry(), new T.MeshBasicMaterial()); mover.name = 'mover'; scene.add(mover); mover.add(mesh);
    const source = adoptModel({ scene, scenes: [scene], cameras: [], animations: [new T.AnimationClip('prop', 2, [new T.VectorKeyframeTrack('mover.position', [0, 2], [1, 0, 0, 5, 1, 3])])] }, '', []);
    const info = source.inspection; assert.equal(info.bones.length, 0); assert.equal(info.nodes.find(n => n.path === '0/0')!.positionAnimated, true);
    const a = source.instantiate(), ca = new ModelMotion(a); ca.sample(0, 1, false, motion); close(a.nodePosition('0/0').toArray(), [1, .5, 0]);
    const prop = entity('prop', 'external-model', 'prop'); prop.external = { resourceId: 'test', appearance: 'original', unitScale: 1, orientation: [0, 0, 0] };
    prop.clips = [{ id: 'native', action: 'native', native: { index: 0, loop: true, motion }, start: 0, end: 2, speed: 1 }];
    assertNativeBindings(prop, info.animations, info.nodes);
    assert.throws(() => assertNativeBindings(prop, info.animations, []), /参考点不存在/);
    for (const invalid of [null, { mode: 'source', node: '0' }, { mode: 'inPlace', node: 'bad' }, { mode: 'inPlace', node: '0', unexpected: true }]) assert.throws(() => assertNativeClip({ ...prop.clips[0], native: { ...prop.clips[0].native!, motion: invalid } } as Clip, true));
    source.dispose();
});
