import test from 'node:test';
import assert from 'node:assert/strict';
import { fitStride, fitStrideFoot, applyStrideEstimate } from '../src/animation/stride-fit.ts';
import { measureStride } from '../src/animation/stride-measurement.ts';
import { entity } from '../src/model.ts';
import { makeHuman } from '../src/assets/humanoid.ts';
import { builtinHumanoidSkeleton } from '../src/animation/builtin-humanoid.ts';
import { footPlantProfile } from '../src/animation/foot-plant-presets.ts';
import { applyOperationsWithResources } from '../src/automation/edits.ts';
import { createScene } from '../src/scenes.ts';
import { sliceAction } from '../src/clip-editing.ts';
import { retargetClipTime } from '../src/animation/locomotion.ts';
const near = (a: number, b: number, e = 1e-8) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);
const samples = (stride: number, lateral = 0, offset = 0) => Array.from({ length: 25 }, (_, i) => { const phase = .1 + i / 60; return { phase, x: lateral * phase, z: offset - stride * phase }; });

test('measured stance regression is translation invariant and exposes asymmetric, nonlinear and unsupported motion', () => {
    const a = fitStride(samples(1.4, 0, 10), samples(1.4, 0, -2), 1.3);
    near(a.cycleDistance!, 1.4); assert.equal(a.quality, 'usable'); near(a.feet.left.relativeError, 0);
    assert.equal(fitStride(samples(1), samples(2), 1).quality, 'review');
    assert.equal(fitStride(samples(1, .5), samples(1, .5), 1).quality, 'review');
    const nonlinear = samples(1).map((s, i) => ({ ...s, z: s.z + .15 * Math.sin(i * .8) }));
    assert.equal(fitStride(nonlinear, nonlinear, 1).quality, 'review');
    for (const stride of [0, -.4]) { const result = fitStride(samples(stride), samples(stride), 1); assert.equal(result.quality, 'unsupported'); assert.equal(result.cycleDistance, null); }
    assert.throws(() => fitStrideFoot([{ phase: 0, x: 0, z: 0 }]));
    assert.throws(() => fitStrideFoot(samples(1).map(s => ({ ...s, phase: 0 }))));
});
test('calibration samples the real target proportion and scale, restores its exact pose even on failure', () => {
    const e = entity('actor', 'human-adult', 'test'), r = makeHuman(e), skeleton = builtinHumanoidSkeleton(r, e);
    r.root.position.set(7, 2, -3); r.root.rotation.y = 1.2; r.root.scale.set(1.3, .7, 2);
    const nodes: typeof r.root[] = []; r.root.traverse(n => { if (n.isObject3D) nodes.push(n as typeof r.root); });
    const capture = () => nodes.map(n => [...n.position.toArray(), ...n.quaternion.toArray(), ...n.scale.toArray()]);
    const before = capture();
    // Known local contact translation generates a 2m scene stride under the target's Z scale of 2.
    const fit = measureStride(skeleton, footPlantProfile('human-walk-v1')!, 1, phase => { skeleton.resetReference(); r.hips.position.z = -phase; });
    near(fit.cycleDistance!, 2); assert.deepEqual(capture(), before);
    assert.throws(() => measureStride(skeleton, footPlantProfile('human-walk-v1')!, 1, () => { r.hips.position.y = 100; throw Error('sampling failed'); }), /sampling failed/);
    assert.deepEqual(capture(), before);
});
test('applying an estimate preserves the retained initial source phase and restores calibrated cadence', async () => {
    const p = await applyOperationsWithResources(createScene('blank'), [{ operation: 'add', id: 'a', asset: 'human-adult' }, { operation: 'motion', id: 'a', asset: 'human-walk-v1', time: 0 }]);
    const e = p.entities.find(e => e.id === 'a')!, full = e.clips[0]; full.speed = 1.4; full.offset = .2;
    const c = sliceAction(full, .8, full.end), before = retargetClipTime(e, c, c.start, 4 / 3);
    applyStrideEstimate(e, c, fitStride(samples(1.2), samples(1.2), 4 / 3));
    near(retargetClipTime(e, c, c.start, 4 / 3), before); near(c.retarget!.locomotion!.cycleDistance, 1.2);
    assert.equal(c.speed, 1); assert.equal(c.progressOffset, 0); assert.equal(c.retarget!.loop, true); assert.equal(c.retarget!.motion!.mode, 'inPlace');
    e.locked = true; assert.throws(() => applyStrideEstimate(e, c, fitStride(samples(1), samples(1), 1)), /锁定/);
});
