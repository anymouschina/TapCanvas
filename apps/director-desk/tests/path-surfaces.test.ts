import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { entity, demoProject, clone } from '../src/model.ts';
import { pathPosition } from '../src/timeline.ts';
import { makeProp, makeRoom, disposeTree } from '../src/assets.ts';
import { applyPathSurfaceCorrections, checkPathSurfaces, pathSurfaceSamples, pathSurfaceModels, ROOM_FLOOR_SURFACE } from '../src/spatial/path-surfaces.ts';

function fixture() {
    const project = demoProject(); project.entities = project.entities.filter(e => e.kind === 'camera');
    const stairs = entity('prop', 'stairs', 'stairs'), actor = entity('actor', 'human-adult', 'walker');
    stairs.id = 'steps'; actor.id = 'walker'; actor.path = { smooth: false, points: Array.from({ length: 6 }, (_, i) => ({ time: i, position: [0, (i + 1) * .18, -i * .28] as [number, number, number] })) };
    project.entities.push(stairs, actor);
    const models = new Map<string, Group>(), rebuild = () => { models.forEach(disposeTree); models.clear(); for (const e of project.entities.filter(e => e.kind === 'prop')) { const root = makeProp(e); root.position.fromArray(e.position); root.rotation.set(...e.rotation); root.scale.fromArray(e.scale); models.set(e.id, root); } };
    rebuild(); return { project, stairs, actor, models, rebuild, dispose: () => models.forEach(disposeTree) };
}
test('changing step height exposes stale waypoint elevations and correction preserves route timing and XZ', () => {
    const f = fixture();
    try {
        const options = { entityId: f.actor.id, surfaceId: f.stairs.id };
        assert.ok(checkPathSurfaces(f.project, f.models, options).points.filter(p => p.waypointIndex !== null).every(p => p.status === 'on-surface'));
        const original = clone(f.actor.path!); f.stairs.parameters = { rise: .25 }; f.rebuild();
        const report = checkPathSurfaces(f.project, f.models, options);
        assert.ok(report.points.filter(p => p.waypointIndex !== null).every(p => p.status === 'below'));
        assert.equal(applyPathSurfaceCorrections(f.project, report), 6);
        for (const [index, p] of f.actor.path!.points.entries()) { assert.ok(Math.abs(p.position[1] - (index + 1) * .25) < 1e-7); assert.equal(p.time, original.points[index].time); assert.equal(p.position[0], original.points[index].position[0]); assert.equal(p.position[2], original.points[index].position[2]); }
        assert.ok(checkPathSurfaces(f.project, f.models, options).points.filter(p => p.waypointIndex !== null).every(p => p.status === 'on-surface'));
        assert.throws(() => applyPathSurfaceCorrections(f.project, report), /重新检查/);
    } finally { f.dispose(); }
});
test('multiple floors, missing surfaces, locks and stale geometry never cause an automatic wrong-floor correction', () => {
    const f = fixture();
    try {
        f.stairs.parameters = { rise: .25 }; const floor = entity('prop', 'ground', 'lower floor'); f.project.entities.push(floor); f.rebuild();
        const report = checkPathSurfaces(f.project, f.models, { entityId: f.actor.id });
        assert.ok(report.points.filter(p => p.waypointIndex !== null).every(p => p.status === 'ambiguous' && p.suggested === null));
        assert.throws(() => applyPathSurfaceCorrections(f.project, report), /没有可直接校正/);
        const targeted = checkPathSurfaces(f.project, f.models, { entityId: f.actor.id, surfaceId: f.stairs.id });
        f.actor.locked = true; assert.throws(() => applyPathSurfaceCorrections(f.project, targeted), /锁定/); f.actor.locked = false;
        f.stairs.position[0] = 5; f.rebuild(); assert.throws(() => applyPathSurfaceCorrections(f.project, targeted), /重新检查/);
        assert.ok(checkPathSurfaces(f.project, f.models, { entityId: f.actor.id, surfaceId: f.stairs.id }).points.every(p => p.status === 'no-surface'));
    } finally { f.dispose(); }
});
test('checks preserve retained source ranges, detect intermediate gaps and allow camera clearance without changing the curve', () => {
    const f = fixture();
    try {
        f.actor.path!.sections = [{ start: 9, end: 10, from: 1, to: 2 }];
        const samples = pathSurfaceSamples(f.actor.path!); assert.ok(samples.every(p => p.sourceTime >= 1 && p.sourceTime <= 2)); assert.ok(samples.some(p => p.waypointIndex === null));
        f.actor.path!.points.forEach(p => p.position[1] += 1.7);
        const before = JSON.stringify(f.project), report = checkPathSurfaces(f.project, f.models, { entityId: f.actor.id, surfaceId: f.stairs.id, clearance: 1.7 });
        assert.ok(report.points.filter(p => p.waypointIndex !== null).every(p => p.status === 'on-surface')); assert.equal(JSON.stringify(f.project), before);
        f.stairs.path = { smooth: false, points: [{ time: 0, position: [0, 0, 0] }] };
        assert.throws(() => checkPathSurfaces(f.project, f.models, { entityId: f.actor.id, surfaceId: f.stairs.id }), /静态/);
    } finally { f.dispose(); }
});

test('rotated and scaled stairs use actual world surfaces instead of untransformed parameter heights', () => {
    const f = fixture();
    try {
        f.stairs.position = [2, 1, 3]; f.stairs.rotation = [0, Math.PI / 2, 0]; f.stairs.scale = [1.2, 1.5, .8]; f.rebuild();
        const root = f.models.get(f.stairs.id)!; root.updateWorldMatrix(true, true);
        f.actor.path!.points.forEach(p => { p.position = root.localToWorld(new Vector3(...p.position)).toArray(); });
        const report = checkPathSurfaces(f.project, f.models, { entityId: f.actor.id, surfaceId: f.stairs.id });
        assert.ok(report.points.filter(p => p.waypointIndex !== null).every(p => p.status === 'on-surface'));
        f.actor.path!.points[2].position[0] += 10;
        const gap = checkPathSurfaces(f.project, f.models, { entityId: f.actor.id, surfaceId: f.stairs.id });
        assert.equal(gap.points.find(p => p.waypointIndex === 2)!.status, 'no-surface');
    } finally { f.dispose(); }
});

test('built-in room floor is checked as finite real geometry and disappears when the room is disabled', () => {
    const f = fixture(), room = makeRoom(f.project);
    try {
        const models = pathSurfaceModels({ models: f.models, roomGroup: room.group, walls: room.walls });
        f.actor.path = { smooth: false, points: [{ time: 0, position: [0, .1, 0] }, { time: 1, position: [100, .1, 0] }] };
        const report = checkPathSurfaces(f.project, models, { entityId: f.actor.id, surfaceId: ROOM_FLOOR_SURFACE });
        assert.equal(report.points.find(p => p.waypointIndex === 0)!.status, 'above');
        assert.equal(report.points.find(p => p.waypointIndex === 1)!.status, 'no-surface');
        f.project.room.enabled = false;
        assert.throws(() => checkPathSurfaces(f.project, models, { entityId: f.actor.id, surfaceId: ROOM_FLOOR_SURFACE }), /未找到/);
    } finally { disposeTree(room.group); f.dispose(); }
});

test('surface checks follow continuous bends in retained source ranges instead of the legacy straight route', () => {
    const project = demoProject(); project.room.enabled = false; project.duration = 12;
    const surface = entity('prop', 'cube', 'finite platform'), actor = entity('actor', 'human-adult', 'walker');
    actor.path = { smooth: false, interpolation: 'continuous', points: [
        { time: 0, position: [0, 0, 0] }, { time: 1, position: [1, 0, 0] }, { time: 3, position: [1, 0, 1] },
    ], sections: [{ start: 10, end: 11, from: 0, to: 1 }] };
    project.entities.push(surface, actor);
    const root = new Group(), platform = new Mesh(new BoxGeometry(2, .2, 2), new MeshBasicMaterial());
    platform.position.set(.5, -.1, 1); root.add(platform);
    const models = new Map([[surface.id, root]]);
    try {
        const report = checkPathSurfaces(project, models, { entityId: actor.id, surfaceId: surface.id });
        assert.ok(report.points.every(point => point.sourceTime >= 0 && point.sourceTime <= 1), 'section playback times do not replace source sampling times');
        const bend = report.points.find(point => Math.abs(point.sourceTime - .5) < 1e-8)!;
        assert.ok(bend, 'the retained segment includes an intermediate surface check');
        assert.equal(bend.status, 'no-surface', 'the continuous bend leaves the edge of the finite platform');
        assert.ok(bend.position[2] < -.01, 'interior velocity rounds the corner outside the straight segment');
        assert.deepEqual(bend.position, pathPosition(actor.path, actor.position, 10.5).toArray(), 'the checked location equals the actual playback location');
        assert.ok(report.points.filter(point => point.waypointIndex !== null).every(point => point.status === 'on-surface'));
        delete actor.path.interpolation;
        const legacy = checkPathSurfaces(project, models, { entityId: actor.id, surfaceId: surface.id });
        assert.ok(legacy.points.every(point => point.status === 'on-surface'), 'the same points with legacy straight interpolation stay on the platform');
    } finally { disposeTree(root); }
});
