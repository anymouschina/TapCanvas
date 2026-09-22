import test from 'node:test';
import assert from 'node:assert/strict';
import { assertEasing, eased, numberAt, type Easing } from '../src/animation/channels.ts';
import { demoProject, entity, clone, assertProject } from '../src/model.ts';
import { entityPosition } from '../src/timeline.ts';
import { editLocations } from '../src/automation/edit-locations.ts';
import { curveTargets, insertCurvePause } from '../src/animation/curve-targets.ts';
import { applyOperations } from '../src/automation/edits.ts';

test('Bezier timing solves x before y and preserves endpoints, bounded output and deterministic seeking', () => {
    const quadratic: Easing = { bezier: [1 / 3, 0, 2 / 3, 1 / 3] };
    for (const t of [0, .001, .1, .25, .5, .9, .999, 1]) assert.ok(Math.abs(eased(t, quadratic) - t * t) < 1e-6);
    const slow: Easing = { bezier: [.8, 0, 1, 1] }; assert.ok(eased(.5, slow) < .3);
    for (const curve of [{ bezier: [0, 1, 0, 0] }, { bezier: [1, 0, 1, 1] }, { bezier: [1, 1, 0, 0] }]) {
        assertEasing(curve); for (let i = 0; i <= 100; i++) assert.ok(eased(i / 100, curve as Easing) >= 0 && eased(i / 100, curve as Easing) <= 1);
    }
    for (const value of [null, {}, [], { bezier: [0, 0, 1] }, { bezier: [0, NaN, 1, 1] }, { bezier: [-1, 0, 1, 1] }, { bezier: [0, 0, 1, 2] }, { bezier: [0, 0, 1, 1], extra: true }]) assert.throws(() => assertEasing(value));
    const keys = { keys: [{ time: 0, value: 10 }, { time: 10, value: 30, easing: quadratic }] };
    assert.ok(Math.abs(numberAt(keys, 5) - 15) < 1e-5); numberAt(keys, 9); assert.ok(Math.abs(numberAt(keys, 5) - 15) < 1e-5);
});

test('curves use real path/channel keys and survive shared automation validation and file round trip', () => {
    const p = demoProject(), actor = p.entities.find(e => e.kind === 'actor')!;
    const next = applyOperations(p, [{ operation: 'update', id: actor.id, patch: { path: { smooth: false, points: [{ time: 0, position: [0, 0, 0] }, { time: 10, position: [10, 0, 0], easing: { bezier: [1 / 3, 0, 2 / 3, 1 / 3] } }] } } }]);
    const e = next.entities.find(e => e.id === actor.id)!;
    assert.ok(Math.abs(entityPosition(e, 5).x - 2.5) < 1e-5);
    curveTargets(e)[0].keys[1].easing = 'hold'; assert.equal(entityPosition(e, 5).x, 0); assert.equal(entityPosition(e, 10).x, 10);
    assertProject(JSON.parse(JSON.stringify(next)));
    const lamp = entity('prop', 'light-spot', 'Lamp'); lamp.light!.intensity = { keys: [{ time: 0, value: 1 }, { time: 10, value: 10 }] };
    assert.equal(curveTargets(lamp)[0].keys, lamp.light!.intensity.keys);
});

test('change locations describe real deltas, neighbour ranges, removal and static full-scene changes', () => {
    const p = demoProject(); p.duration = 20;
    const actor = p.entities.find(e => e.kind === 'actor')!;
    actor.path = { smooth: false, points: [0, 5, 10, 15].map(time => ({ time, position: [time, 0, 0] })) };
    actor.clips = [{ id: 'walk', start: 2, end: 4, action: 'walk', speed: 1 }];
    const next = clone(p), edited = next.entities.find(e => e.id === actor.id)!;
    edited.path!.points[1].position[0] = 9; edited.color = '#123456'; edited.clips[0].end = 7;
    const rows = editLocations(p, next);
    assert.deepEqual(rows.find(r => r.field === '运动路径'), { entityId: actor.id, name: actor.name, action: 'updated', field: '运动路径', start: 0, end: 10 });
    assert.deepEqual(rows.find(r => r.field === '动作') && [rows.find(r => r.field === '动作')!.start, rows.find(r => r.field === '动作')!.end], [2, 7]);
    assert.equal(rows.find(r => r.field === '颜色')!.end, 20);
    assert.deepEqual(editLocations(p, clone(p)), []);
    next.entities = next.entities.filter(e => e.id !== actor.id); assert.equal(editLocations(p, next).find(r => r.entityId === actor.id)!.action, 'removed');
    next.entities = clone(p.entities); next.entities[0].poseKeys = []; for (const row of editLocations(p, next)) assert.ok(Number.isFinite(row.start) && row.end >= row.start);
});


test('curve pause duplicates the start state, shifts only its later keys and preserves neighbouring easing', () => {
    const e = entity('prop', 'light-point', 'Lamp'); e.light!.intensity = {keys:[{time:2,value:10},{time:5,value:100,easing:{bezier:[.8,0,1,1]}}]};
    const old = clone(e.light!.intensity);
    assert.equal(insertCurvePause(e,'light:intensity',1),6);
    assert.equal(numberAt(e.light!.intensity,2.5),10);
    assert.deepEqual(e.light!.intensity.keys[2].easing,old.keys[1].easing);
    for(const t of [0,.5,1,2.5,3]) assert.ok(Math.abs(numberAt(old,2+t)-numberAt(e.light!.intensity,3+t))<1e-6);
    e.locked=true;assert.throws(()=>insertCurvePause(e,'light:intensity',1));
});
