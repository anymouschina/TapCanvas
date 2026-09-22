import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { clone, entity, demoProject, assertProject } from '../src/model.ts';
import { applyOperations } from '../src/automation/edits.ts';
import { applyHandBinding, detachHandBinding, editBoundTransform } from '../src/animation/hand-binding.ts';
import { builtinHandFrame } from '../src/animation/hand-frame.ts';
import { makeHuman, scaleHuman } from '../src/assets/humanoid.ts';
import { sampleHumanAction } from '../src/assets/human-animation.ts';
import { recordPositionKey } from '../src/editor/position-keys.ts';
import { disposeTree } from '../src/assets/dispose.ts';

test('hand binding is portable and rejects dangling targets, conflicting paths and changes to locked props', () => {
    const p = demoProject(), actor = p.entities.find(e => e.kind === 'actor')!;
    const next = applyOperations(p, [{ operation: 'add', id: 'held', asset: 'cup', patch: { handBinding: { actorId: actor.id, hand: 'left', offset: [.01, 0, 0], rotation: [0, 0, .3] } } }]);
    assertProject(JSON.parse(JSON.stringify(next))); const prop = next.entities.find(e => e.id === 'held')!;
    for (const patch of [{ handBinding: { ...prop.handBinding, actorId: 'missing' } }, { handBinding: { ...prop.handBinding, hand: 'foot' } }, { handBinding: { ...prop.handBinding, offset: [NaN, 0, 0] } }, { path: { smooth: false, points: [{ time: 0, position: [0, 0, 0] }] } }])
        assert.throws(() => applyOperations(next, [{ operation: 'update', id: prop.id, patch }]));
    assert.throws(() => applyOperations(next, [{ operation: 'remove', id: actor.id }]), /引用/);
    assert.throws(() => recordPositionKey(prop, 1, [0, 0, 0], 24), /解除绑定/);
    prop.locked = true; assert.throws(() => applyOperations(next, [{ operation: 'update', id: prop.id, patch: { handBinding: null } }]), /锁定/);
    assert.equal(p.entities.some(e => e.id === 'held'), false);
});

test('actual hand transforms follow both arms across proportions while prop size stays independent', () => {
    for (const asset of ['person', 'human-adult', 'human-dwarf', 'human-giant']) {
        const actor = entity('actor', asset, asset); actor.clips = [{ id: 'wave', action: 'wave', start: 0, end: 4, speed: 1 }];
        const rig = makeHuman(actor); scaleHuman(rig, actor); rig.root.position.set(3, .4, -2); rig.root.rotation.y = .7;
        try {
            for (const hand of ['left', 'right'] as const) {
                const prop = new T.Group(); prop.scale.set(.3, .5, .7);
                const binding = { actorId: actor.id, hand, offset: [.03, .02, -.01] as [number, number, number], rotation: [.1, .2, .3] as [number, number, number] };
                const sample = (time: number) => { sampleHumanAction(rig, actor, time); rig.root.updateWorldMatrix(true, true); const frame = builtinHandFrame(actor, rig, hand); applyHandBinding(prop, binding, frame); return prop.matrixWorld.toArray(); };
                const first = sample(.4); sample(2.8); const again = sample(.4); assert.deepEqual(first, again); assert.deepEqual(prop.scale.toArray(), [.3, .5, .7]);
                const frame = builtinHandFrame(actor, rig, hand); assert.ok(prop.position.distanceTo(frame.position) - Math.hypot(...binding.offset) < 1e-8);
            }
        } finally { disposeTree(rig.root); }
    }
});

test('world gizmo adjustments invert into hand offsets and detach preserves the evaluated transform', () => {
    const e = entity('prop', 'sword', 'held'), root = new T.Group(); root.scale.set(1.2, .8, 1);
    e.handBinding = { actorId: 'actor', hand: 'right', offset: [0, 0, 0], rotation: [0, 0, 0] };
    const frame = { position: new T.Vector3(3, 2, -1), rotation: new T.Quaternion().setFromEuler(new T.Euler(.3, -.6, .8)) };
    const position: [number, number, number] = [3.1, 2.2, -1.2], rotation: [number, number, number] = [.4, .2, -.7];
    editBoundTransform(e, frame, position, rotation); applyHandBinding(root, e.handBinding, frame);
    assert.ok(root.position.distanceTo(new T.Vector3(...position)) < 1e-10); assert.ok(root.quaternion.angleTo(new T.Quaternion().setFromEuler(new T.Euler(...rotation))) < 1e-7);
    const original = clone(e); e.locked = true; assert.throws(() => detachHandBinding(e, root), /锁定/); e.locked = false; assert.deepEqual(e, original);
    detachHandBinding(e, root); assert.equal(e.handBinding, null); assert.deepEqual(e.position, root.position.toArray()); assert.deepEqual(e.rotation, [root.rotation.x, root.rotation.y, root.rotation.z]);
});
