import test from 'node:test';
import assert from 'node:assert/strict';
import { entity, type Clip } from '../src/model.ts';
import { footPlantPlans, footPlantSamplingEntity } from '../src/animation/foot-plant-plan.ts';
import { builtinFootPlant } from '../src/animation/motion-catalog.ts';
import { sliceAction } from '../src/clip-editing.ts';
import { applyOperations, applyOperationsWithResources } from '../src/automation/edits.ts';
import { createScene } from '../src/scenes.ts';
import { makeHuman } from '../src/assets/humanoid.ts';
import { builtinHumanoidSkeleton } from '../src/animation/builtin-humanoid.ts';
import { FootGrounding } from '../src/animation/foot-grounding.ts';
import { applyFootPlants, captureFootAnchor, measureFootPlants } from '../src/animation/foot-plant.ts';

const near = (a: number, b: number, e = 1e-7) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);
async function fixture() {
    const p = await applyOperationsWithResources(createScene('blank'), [{ operation: 'add', id: 'a', asset: 'human-adult' }, { operation: 'motion', id: 'a', asset: 'human-walk-v1', time: 0 }]);
    const e = p.entities.find(e => e.id === 'a')!, c = e.clips[0];
    c.retarget!.footPlant = builtinFootPlant(c); c.retarget!.grounding = { mode: 'preventPenetration', maxCorrection: .2 };
    return { p, e, c };
}
test('stance anchors survive repeated splits, deleted earlier slices, source offsets and crowd phases', async () => {
    const { e, c } = await fixture(); c.end = 12; c.offset = .31; c.speed = 1.3;
    for (const distance of [false, true]) {
        if (distance) {
            c.retarget!.locomotion = { mode: 'distance', cycleDistance: 1 };
            e.path = { smooth: false, points: [{ time: 0, position: [0, 0, 0] }, { time: 3, position: [0, 0, 2] }, { time: 5, position: [0, 0, 2] }, { time: 12, position: [1, 0, 6] }] };
        }
        for (const phase of [0, .527, 4.19]) {
            const pieces = [sliceAction(c, 0, 2.2), sliceAction(c, 2.2, 12)];
            const right = pieces.pop()!; pieces.push(sliceAction(right, 2.2, 3.7), sliceAction(right, 3.7, 12));
            for (const time of [.1, 2.3, 3.9, 4.6, 6.7, 9.8]) {
                const piece = pieces.find(c => time >= c.start && time < c.end)!;
                const expected = footPlantPlans(e, c, time, 4 / 3, phase), actual = footPlantPlans(e, piece, time, 4 / 3, phase);
                assert.equal(actual.length, expected.length);
                actual.forEach((a, i) => { assert.equal(a.side, expected[i].side); near(a.anchorTime, expected[i].anchorTime); near(a.weight, expected[i].weight); });
                const restored = footPlantSamplingEntity({ ...e, clips: [piece] }, piece).clips[0];
                near(restored.start, 0); near(restored.offset!, c.offset!);
            }
        }
        if (distance) {
            const a = footPlantPlans(e, c, 3.9, 4 / 3), b = footPlantPlans(e, c, 4.9, 4 / 3);
            assert.equal(a.length, b.length); a.forEach((p, i) => { near(p.anchorTime, b[i].anchorTime); near(p.weight, b[i].weight); });
        }
    }
});
test('wrapping contacts, fade boundaries, stationary clocks and section teleports', async () => {
    const { e, c } = await fixture(); c.offset = 0; c.speed = 1; c.end = 10;
    const a = footPlantPlans(e, c, .99, 1).find(p => p.side === 'right')!;
    const b = footPlantPlans(e, c, 1.005, 1).find(p => p.side === 'right')!;
    near(a.anchorTime, .52); near(b.anchorTime, .52); assert.ok(b.weight < a.weight);
    assert.equal(footPlantPlans(e, c, 1.02, 1).length, 0);
    c.retarget!.locomotion = { mode: 'distance', cycleDistance: 1 }; c.offset = .2;
    const still = footPlantPlans(e, c, 8, 1); near(still[0].anchorTime, 0);
    e.path = { smooth: false, points: [{ time: 0, position: [0, 0, 0] }, { time: 10, position: [0, 0, 10] }], sections: [{ start: 0, end: 1, from: 0, to: .1 }, { start: 1, end: 2, from: 5, to: 5.1 }] };
    near(footPlantPlans(e, c, 1.2, 1)[0].anchorTime, 1);
});
test('actual foot vertex stays anchored, without changing bone offsets or pinning unsupported feet', () => {
    for (const asset of ['human-adult', 'human-dwarf', 'human-giant']) {
        const e = entity('actor', asset, 'a'), rig = makeHuman(e), s = builtinHumanoidSkeleton(rig, e), grounding = new FootGrounding(s);
        s.bones.leftUpperLeg!.rotation.x = -.2; s.bones.leftLowerLeg!.rotation.x = .4;
        const anchor = captureFootAnchor(grounding, { side: 'left', anchorTime: 0, weight: 1 });
        const offsets = Object.values(s.bones).map(n => n.position.toArray()), rotation = s.bones.leftFoot!.getWorldQuaternion(rig.root.quaternion.clone());
        rig.root.position.z += .01; rig.root.updateMatrixWorld(true);
        const result = applyFootPlants(s, [anchor], .2, () => anchor.world.y); const measured = measureFootPlants(result)[0];
        assert.equal(measured.status, 'locked'); near(measured.residual, 0, 1e-5);
        assert.deepEqual(Object.values(s.bones).map(n => n.position.toArray()), offsets);
        near(1 - Math.abs(s.bones.leftFoot!.getWorldQuaternion(rotation.clone()).dot(rotation)), 0);
        const quats = Object.values(s.bones).map(n => n.quaternion.toArray());
        const unsupported = measureFootPlants(applyFootPlants(s, [anchor], .2, () => null))[0];
        assert.equal(unsupported.status, 'no-surface'); assert.deepEqual(Object.values(s.bones).map(n => n.quaternion.toArray()), quats);
        rig.root.position.z += 2; rig.root.updateMatrixWorld(true);
        assert.equal(measureFootPlants(applyFootPlants(s, [anchor], .02, () => anchor.world.y))[0].status, 'limited');
    }
});
test('invalid contact profiles or missing dependencies reject edits atomically', async () => {
    const { p, e, c } = await fixture(), before = JSON.stringify(p);
    for (const patch of [{ footPlant: false }, { footPlant: { ...c.retarget!.footPlant, left: [0, 1] } },
        { footPlant: { ...c.retarget!.footPlant, fade: 0 } }, { footPlant: { ...c.retarget!.footPlant, maxCorrection: NaN } },
        { loop: false }, { motion: undefined }, { grounding: undefined }]) {
        const bad: Clip = structuredClone(c); Object.assign(bad.retarget!, patch);
        assert.throws(() => applyOperations(p, [{ operation: 'update', id: e.id, patch: { clips: [bad] } }]));
    }
    assert.equal(JSON.stringify(p), before);
});
