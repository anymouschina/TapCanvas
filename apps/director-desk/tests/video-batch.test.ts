import test from 'node:test';
import assert from 'node:assert/strict';
import { demoProject, type Project } from '../src/model.ts';
import { estimatedVideoBytes, planVideoExports, type ExportScene } from '../src/exporting/plan.ts';
import { runVideoExports, type ExportDestination } from '../src/exporting/batch.ts';
import type { Engine } from '../src/engine.ts';
import type { exportVideo } from '../src/export.ts';

const scenes: ExportScene[] = [
    { id: 'a', name: '第一场', duration: 2, fps: 24, aspect: '16:9' },
    { id: 'b', name: '第二场', duration: 3, fps: 30, aspect: '9:16' },
];
const settings = { size: 640, fps: 'scene', format: 'mp4', monochrome: false } as const;
const selection = [{ sceneId: 'a', filename: '同名.mp4' }, { sceneId: 'b', filename: '同名' }];
test('batch exports preserve per-scene timing/aspect/cuts, normalize filenames and distinguish collisions', () => {
    const jobs = planVideoExports(scenes, selection, settings);
    assert.deepEqual(jobs.map(j => j.filename), ['同名.mp4', '同名 (2).mp4']);
    assert.deepEqual(jobs.map(j => [j.options.width, j.options.height, j.options.fps, j.options.end, j.options.cameraId]),
        [[640, 360, 24, 2, 'program'], [360, 640, 30, 3, 'program']]);
    const named = planVideoExports(scenes, [{ sceneId: 'a', filename: 'CON' }, { sceneId: 'b', filename: '../场:次.webm' }], settings);
    assert.deepEqual(named.map(j => j.filename), ['_CON.mp4', '_场_次.mp4']);
    assert.equal(estimatedVideoBytes(jobs[0]), 500000, 'minimum encoder bitrate is included');
    assert.equal(planVideoExports(scenes, [selection[0]], { ...settings, fps: 60 }, { start: .5, end: 1.5, cameraId: 'camera-a' })[0].options.cameraId, 'camera-a');
    assert.throws(() => planVideoExports(scenes, [], settings), /至少/);
    assert.throws(() => planVideoExports(scenes, [selection[0]], settings, { start: 0, end: 3, cameraId: 'program' }), /范围/);
    assert.throws(() => planVideoExports(scenes, [{ sceneId: 'a', filename: ' ' }], settings), /文件名/);
});

function harness() {
    const original = demoProject();
    const engine = { project: original, time: 1.25, previewId: 'original-camera', selected: 'original-person', selectedPoint: 2,
        monochrome: true, exporting: false, dragging: false, drawingPath: false, disposed: false,
        externalModels: { prepare: async (_project: Project, signal: AbortSignal) => signal.throwIfAborted() },
        rebuild(project: Project) { this.project = project; this.selectedPoint = -1; },
        select(id: string, point: number) { this.selected = id; this.selectedPoint = point; },
        restorePreview(time: number) { this.time = time; this.exporting = false; },
    };
    const projects = new Map(scenes.map(s => [s.id, { ...demoProject(), name: s.id, duration: s.duration, aspect: s.aspect, fps: s.fps }]));
    const saved: string[] = [], completed: string[] = [], visited: string[] = [], progress: number[] = [];
    const destination: ExportDestination = { open: async () => undefined, save: async (job, blob) => {
        assert.ok(blob); saved.push(job.sceneId); return job.filename;
    } };
    const encode: typeof exportVideo = async (target, _options, signal, report) => {
        visited.push(target.project.name); target.time = 0; target.monochrome = false; target.exporting = true;
        signal.throwIfAborted(); report(.5); report(1); target.exporting = false; return new Blob(['video']);
    };
    const controller = new AbortController();
    const run = (encoder = encode) => runVideoExports(engine as unknown as Engine, planVideoExports(scenes, selection, settings),
        id => projects.get(id)!, destination, controller.signal, (_job, _index, fraction) => progress.push(fraction),
        (job, name) => { assert.equal(name, job.filename); completed.push(job.sceneId); }, encoder);
    const restored = () => {
        assert.equal(engine.project, original); assert.equal(engine.time, 1.25); assert.equal(engine.previewId, 'original-camera');
        assert.equal(engine.selected, 'original-person'); assert.equal(engine.selectedPoint, 2); assert.equal(engine.monochrome, true); assert.equal(engine.exporting, false);
    };
    return { engine, destination, controller, run, encode, restored, saved, completed, visited, progress };
}
test('batch renders and saves sequentially with weighted progress and restores the editor', async () => {
    const h = harness(); await h.run(); h.restored();
    assert.deepEqual(h.saved, ['a', 'b']); assert.deepEqual(h.completed, ['a', 'b']); assert.deepEqual(h.visited, ['a', 'b']);
    assert.equal(h.progress.at(-1), 1); assert.equal(h.progress[1], 24 / 138);
    assert.ok(h.progress.every((p, i) => i === 0 || p >= h.progress[i - 1]));
});
test('cancellation preserves completed files and does not visit the next scene', async () => {
    const h = harness(), save = h.destination.save;
    h.destination.save = async (job, blob) => { const name = await save(job, blob); h.controller.abort(); return name; };
    await assert.rejects(h.run(), { name: 'AbortError' }); h.restored();
    assert.deepEqual(h.completed, ['a']); assert.deepEqual(h.saved, ['a']); assert.deepEqual(h.visited, ['a']);
});
test('encoder and resource failures restore the editor and do not mark failed outputs as completed', async () => {
    const h = harness();
    await assert.rejects(h.run(async (...args) => { if (args[0].project.name === 'b') throw Error('codec failed'); return h.encode(...args); }), /codec failed/);
    h.restored(); assert.deepEqual(h.completed, ['a']);
    const failed = harness(); failed.engine.externalModels.prepare = async () => { throw Error('missing model'); };
    await assert.rejects(failed.run(), /missing model/); failed.restored(); assert.deepEqual(failed.saved, []);
});
test('disk save failure stops the batch and retains only successfully saved outputs', async () => {
    const h = harness(); h.destination.save = async () => { throw Error('disk full'); };
    await assert.rejects(h.run(), /disk full/); h.restored(); assert.deepEqual(h.completed, []); assert.deepEqual(h.visited, ['a']);
});
