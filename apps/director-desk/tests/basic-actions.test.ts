import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { ASSETS } from '../src/asset-catalog.ts';
import { ACTIONS, entity, type Action } from '../src/model.ts';
import { makeHuman } from '../src/assets/humanoid.ts';
import { sampleHumanAction, sampleHumanBody } from '../src/assets/human-animation.ts';
import { disposeTree } from '../src/assets/dispose.ts';

const humans = ASSETS.filter(a => a.kind === 'actor' && (!a.capabilities || a.capabilities.rig === 'human' || a.capabilities.rig === 'human-legacy'));
test('wave raises its arm outside the head across human proportions without reversing the elbow', () => {
    for (const asset of humans) {
        const e = entity('actor', asset.id, asset.id), rig = makeHuman(e);
        e.clips = [{ id: 'gesture', action: 'wave', start: 0, end: 4, speed: 1 }];
        try {
            const hands: number[] = [];
            for (let time = 0; time < 4; time += .05) {
                sampleHumanAction(rig, e, time); rig.root.updateMatrixWorld(true);
                const shoulder = rig.joints.rightArm.getWorldPosition(new T.Vector3());
                const elbow = rig.joints.rightElbow.getWorldPosition(new T.Vector3());
                const tip = rig.joints.rightElbow.localToWorld(new T.Vector3(0, -.25, 0));
                assert.ok(elbow.x > shoulder.x && tip.x > shoulder.x, `${asset.id}: waving limb must stay outside torso/head center`);
                assert.ok(elbow.y > shoulder.y && tip.y > elbow.y, `${asset.id}: raised greeting gesture`);
                assert.ok(rig.joints.rightElbow.rotation.x <= 0 && rig.joints.rightElbow.rotation.x >= -Math.PI / 2);
                hands.push(tip.z);
            }
            assert.ok(Math.max(...hands) - Math.min(...hands) > .02, 'gesture must actually move');
        } finally { disposeTree(rig.root); }
    }
});

test('all basic actions seek deterministically across humans, and leave no wave pose in subsequent idle', () => {
    for (const asset of humans) {
        const e = entity('actor', asset.id, asset.id), rig = makeHuman(e);
        const state = (time: number) => {
            sampleHumanBody(rig, e, time); rig.root.updateMatrixWorld(true);
            return [rig.hips, ...Object.values(rig.joints)].flatMap(j => j.matrixWorld.toArray());
        };
        try {
            for (const action of Object.keys(ACTIONS) as Action[]) {
                e.clips = [{ id: 'action', action, start: 0, end: 3, speed: 1 }];
                for (const time of [0, .1, .75, 1.5, 2.99, 3, 3.1, 3.3]) {
                    const before = state(time); state(4); state(0); assert.deepEqual(state(time), before, `${asset.id}/${action}/${time}`);
                    assert.ok(before.every(Number.isFinite));
                    for (const side of ['left', 'right']) assert.ok(rig.joints[`${side}Knee`].rotation.x >= 0 && rig.joints[`${side}Knee`].rotation.x <= Math.PI, 'no reverse knee bending');
                }
            }
            e.clips = [{ id: 'wave', action: 'wave', start: 0, end: 3, speed: 1 }]; const after = state(3.3);
            e.clips = []; assert.deepEqual(state(3.3), after, 'wave must fully release its shoulder rotation');
        } finally { disposeTree(rig.root); }
    }
});
