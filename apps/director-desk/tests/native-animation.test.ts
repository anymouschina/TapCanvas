import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { entity, type Clip } from '../src/model.ts';
import { assertNativeClip, assertNativeBindings, nativeSample, nativeSourceTime } from '../src/resources/native-animation.ts';
import { sliceAction } from '../src/clip-editing.ts';
import { adoptModel } from '../src/resources/model-runtime.ts';
import { geometryBounds } from '../src/spatial/geometry.ts';

test('native timeline sampling preserves source time after splitting, moving and changing speed', () => {
    const actor = entity('actor', 'external-model', 'figure');
    const original: Clip = { id: 'native', action: 'native', native: { index: 2, loop: false }, start: 1, end: 5, speed: 1.5, offset: .25 };
    actor.clips = [original];
    const times = [1, 1.9, 2, 2.4, 4.999], before = times.map(t => nativeSample(actor, t));
    actor.clips = [sliceAction(original, 1, 2), sliceAction(original, 2, 5)];
    assert.deepEqual(times.map(t => nativeSample(actor, t)), before);
    assert.equal(nativeSample(actor, 0), null); assert.equal(nativeSample(actor, 5), null);
    actor.clips[1].start += 4; actor.clips[1].end += 4;
    assert.ok(Math.abs(nativeSample(actor, 6.4)!.time - before[3]!.time) < 1e-12);
    assert.equal(nativeSourceTime(4, 2, true), 0); assert.equal(nativeSourceTime(4, 2, false), 2);
    assert.equal(nativeSourceTime(3.5, 2, true), 1.5);
    for (const [time, duration] of [[NaN, 1], [-1, 1], [1, 0], [Infinity, 1]]) assert.throws(() => nativeSourceTime(time, duration, false));
});

test('native clip definitions distinguish source animations from builtin body actions and validate actual sources', () => {
    const clip: Clip = { id: 'native', action: 'native', native: { index: 0, loop: false }, start: 0, end: 2, speed: 1 };
    assertNativeClip(clip, true);
    assert.throws(() => assertNativeClip(clip, false));
    assert.throws(() => assertNativeClip({ ...clip, action: 'idle' }, true));
    for (const native of [undefined, null, {}, { index: -1, loop: false }, { index: 0, loop: 0 }, { index: 0, loop: false, bad: 1 }]) assert.throws(() => assertNativeClip({ ...clip, native } as Clip, true));
    const actor = entity('actor', 'external-model', 'figure'); actor.external = { resourceId: 'test', appearance: 'original', unitScale: 1, orientation: [0, 0, 0] }; actor.clips = [clip];
    assertNativeBindings(actor, [{ index: 0, name: 'animation', duration: 2, tracks: 1 }]);
    assert.throws(() => assertNativeBindings(actor, []), /不存在/);
    assert.throws(() => assertNativeBindings(actor, [{ index: 0, name: 'empty', duration: 0, tracks: 1 }]));
});

test('actual mixer clamps final pose, loops at exact boundaries, resets arbitrary seeks and keeps instances isolated', () => {
    const scene = new T.Group(), bone = new T.Bone(), mesh = new T.Mesh(new T.BoxGeometry(), new T.MeshBasicMaterial()); bone.name = 'moving'; scene.add(bone, mesh);
    const source = adoptModel({ scene, scenes: [scene], cameras: [], animations: [new T.AnimationClip('move', 2, [new T.VectorKeyframeTrack('moving.position', [0, 2], [0, 0, 0, 4, 2, 0])])] }, '', []);
    const a = source.instantiate(), b = source.instantiate(), position = () => a.bonePosition('0/0').toArray();
    a.sampleAnimation(0, 2, false); assert.deepEqual(position(), [4, 2, 0]);
    a.sampleAnimation(0, 20, false); assert.deepEqual(position(), [4, 2, 0]);
    a.sampleAnimation(0, 2, true); assert.deepEqual(position(), [0, 0, 0]);
    a.sampleAnimation(0, .5, false); const half = position(); assert.deepEqual(half, [1, .5, 0]);
    a.sampleAnimation(0, 30, true); a.sampleAnimation(0, .5, false); assert.deepEqual(position(), half);
    assert.deepEqual(b.bonePosition('0/0').toArray(), [0, 0, 0]);
    assert.throws(() => a.sampleAnimation(99, 0)); assert.deepEqual(position(), half);
    a.setDefaultPose({ '0/0': [0, 0, .2] }); assert.deepEqual(position(), [0, 0, 0]);
    a.sampleAnimation(0, 1); assert.deepEqual(position(), [2, 1, 0]);
    source.dispose(); assert.throws(() => a.sampleAnimation(0, 0));
});

test('morph animation bindings stay attached to the rendered mesh across reset, seeks and pose editing', () => {
    const scene = new T.Group(), geometry = new T.BoxGeometry();
    const deltas = new Float32Array(geometry.attributes.position.count * 3); for (let i = 1; i < deltas.length; i += 3) deltas[i] = 2;
    geometry.morphAttributes.position = [new T.Float32BufferAttribute(deltas, 3)]; geometry.morphTargetsRelative = true;
    const mesh = new T.Mesh(geometry, new T.MeshBasicMaterial()); mesh.name = 'shape'; scene.add(mesh);
    const animation = new T.AnimationClip('morph', 2, [new T.NumberKeyframeTrack('shape.morphTargetInfluences[0]', [0, 2], [0, 1])]);
    const source = adoptModel({ scene, scenes: [scene], cameras: [], animations: [animation] }, '', []), a = source.instantiate(), b = source.instantiate();
    for (const time of [1, 0, 2, .5, 1.5, 1]) {
        a.sampleAnimation(0, time, false); assert.ok(Math.abs(geometryBounds(a.root)!.max.y - (.5 + time)) < 1e-6);
        assert.equal(geometryBounds(b.root)!.max.y, .5);
    }
    a.setDefaultPose(); assert.equal(geometryBounds(a.root)!.max.y, .5);
    a.sampleAnimation(0, 1, false); assert.equal(geometryBounds(a.root)!.max.y, 1.5);
    source.dispose();
});
