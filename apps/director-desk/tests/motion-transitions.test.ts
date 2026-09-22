import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { entity, clone, type Clip } from '../src/model.ts';
import { MotionTransitions } from '../src/animation/motion-transitions.ts';
import { motionTransitionAt, transitionGroundingAt } from '../src/animation/transition-plan.ts';
import { sliceAction } from '../src/clip-editing.ts';
import { applyOperationsWithResources, applyOperations } from '../src/automation/edits.ts';
import { createScene } from '../src/scenes.ts';
const near = (a: number, b: number, epsilon = 1e-8) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
const clip = (id: string, start: number, end: number, blend: number): Clip => ({ id, start, end, speed: 1, action: 'retarget', retarget: { blend } as Clip['retarget'] });

test('transition clock preserves entry after repeated cuts, explicit zero, gap exits and contact tail', () => {
    const e = entity('actor', 'person', 'test'); e.clips = [clip('walk', 0, 2, .4), clip('talk', 2, 4, .8)];
    const expected = motionTransitionAt(e, 2.3); assert.equal(expected?.fromClipId, 'walk'); near(expected!.weight, .31640625);
    const c = e.clips.pop()!; e.clips.push(sliceAction(c, 2, 2.2), sliceAction(c, 2.2, 4));
    near(motionTransitionAt(e, 2.3)!.weight, expected!.weight); assert.equal(motionTransitionAt(e, 2.3)!.fromClipId, 'walk');
    assert.equal(motionTransitionAt(e, 3), null);
    const last = e.clips.at(-1)!; last.retarget!.grounding = { mode: 'preventPenetration', maxCorrection: .2 };
    assert.ok(transitionGroundingAt(e, 4.1)); assert.equal(transitionGroundingAt(e, 5), undefined);
    last.retarget!.blend = 0; assert.equal(motionTransitionAt(e, 2.3), null);
});

test('instance-local quaternion, translation and morph transitions are deterministic and leave scene placement unchanged', () => {
    const e = entity('actor', 'person', 'test'); e.clips = [clip('first', 0, 1, .4), clip('second', 1, 3, .4)];
    const frame = new T.Group(), bone = new T.Group(), mesh = new T.Mesh(new T.BoxGeometry(), new T.MeshBasicMaterial());
    frame.add(bone); bone.add(mesh); mesh.morphTargetInfluences = [0]; frame.position.set(20, 3, -7);
    const runtime = new MotionTransitions(); runtime.register(e.id, frame);
    const raw = (t: number) => {
        const second = t >= 1 && t < 3;
        bone.rotation.set(0, T.MathUtils.degToRad(second ? -170 : 170), 0); bone.position.y = second ? 2 : 0; mesh.morphTargetInfluences![0] = second ? 1 : 0;
    };
    const at = (t: number) => { if (!runtime.sample(e.id, e, t, raw)) raw(t); return [...bone.position.toArray(), ...bone.quaternion.toArray(), ...mesh.morphTargetInfluences!]; };
    const mid = at(1.2); near(bone.position.y, 1); near(mesh.morphTargetInfluences![0], .5); near(Math.abs(bone.quaternion.y), 1);
    at(3.1); at(.2); assert.deepEqual(at(1.2), mid); assert.deepEqual(frame.position.toArray(), [20, 3, -7]);
    const state = runtime.state(e.id)!; state.weight = 0; near(runtime.state(e.id)!.weight, .5);
    const input = clone(e.clips[1]); e.clips = [e.clips[0], sliceAction(input, 1, 1.1), sliceAction(input, 1.1, 3)];
    assert.deepEqual(at(1.2), mid);
});

test('trimmed transition chains evaluate the outgoing blended pose rather than jumping to its raw target', () => {
    const e = entity('actor', 'person', 'test');
    e.clips = [clip('a', 0, 1, .5), clip('b', 1, 1.2, .5), clip('c', 1.2, 3, .5)]; e.clips[1].sourceDuration = 1;
    const frame = new T.Group(), bone = new T.Group(); frame.add(bone); const runtime = new MotionTransitions(); runtime.register(e.id, frame);
    const raw = (t: number) => { bone.position.x = t < 1 ? 0 : t < 1.2 ? 10 : 20; };
    runtime.sample(e.id, e, 1.2, raw); near(bone.position.x, 3.52, 1e-5);
    runtime.sample(e.id, e, 1.7, raw); near(bone.position.x, 20);
});

test('bad material blend values fail atomically and existing omitted settings remain valid', async () => {
    const p = await applyOperationsWithResources(createScene('blank'), [{ operation: 'add', id: 'a', asset: 'human-adult' }, { operation: 'motion', id: 'a', asset: 'human-talk-v1', time: 0 }]);
    const c = p.entities.find(e => e.id === 'a')!.clips[0]; assert.equal(c.retarget!.blend, .2); const before = clone(p);
    for (const blend of [-1, 3, Infinity, '0.2']) { const bad = clone(c); Object.assign(bad.retarget!, { blend }); assert.throws(() => applyOperations(p, [{ operation: 'update', id: 'a', patch: { clips: [bad] } }])); }
    assert.deepEqual(p, before); const old = clone(c); delete old.retarget!.blend;
    assert.doesNotThrow(() => applyOperations(p, [{ operation: 'update', id: 'a', patch: { clips: [old] } }]));
});
