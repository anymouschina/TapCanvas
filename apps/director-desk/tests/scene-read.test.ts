import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { demoProject, type ProductionData } from '../src/model.ts';
import type { AppContext } from '../src/app-context.ts';
import { createToolService } from '../src/automation/service.ts';
import { applyOperations } from '../src/automation/edits.ts';
import { validateToolInput } from '../src/automation/validate.ts';
import { MCP_TOOL_DEFINITIONS, TOOL_DEFINITIONS } from '../src/automation/contract.ts';

function fixture() {
    const project = demoProject();
    project.production = { fixedPrompt: '保留风格', sceneReferenceIds: [], notes: [], promptText: '完整成稿'.repeat(2000) };
    const ctx = { project, revision: 0, time: 0, preview: 'program', selected: project.entities[0].id,
        // Accidental eager inspection must fail even when the returned payload later omits it.
        get engine() { throw Error('unrequested engine inspection'); },
    } as unknown as AppContext;
    return { ctx, service: createToolService(ctx) };
}

test('default and selected detailed reads omit unrequested production and global data before computing', async () => {
    const { ctx, service } = fixture();
    const original = JSON.stringify(ctx.project);
    const base = await service.call('director_read'); assert.equal(base.ok, true, base.error ?? 'read failed');
    const selected = await service.call('director_read', { ids: [ctx.project.entities[0].id, 'missing'], details: true });
    assert.equal(selected.ok, true, selected.error ?? 'read failed');
    const data = selected.data as Record<string, any>;
    assert.deepEqual(data.sections, ['entities']); assert.equal(data.entities.length, 1);
    assert.deepEqual(data.entities[0].rotation, ctx.project.entities[0].rotation);
    assert.deepEqual(data.missingIds, ['missing']);
    for (const key of ['production', 'cuts', 'room', 'resources', 'media', 'resourceStatistics', 'mediaRuntime', 'selection', 'geometry']) assert.equal(Object.hasOwn(data, key), false, key);
    assert.equal(data.revision, (base.data as any).revision);
    assert.equal(data.duration, ctx.project.duration); assert.match(data.omitted, /不代表内容为空/);
    assert.equal(JSON.stringify(ctx.project), original);
});

test('only requested partitions return; complete production safely round-trips notes edits without erasing the saved prompt', async () => {
    const { ctx, service } = fixture();
    const result = await service.call('director_read', { sections: ['production', 'cuts'] });
    assert.equal(result.ok, true, result.error ?? 'read failed');
    const data = result.data as { production: ProductionData; cuts: unknown; entities?: unknown };
    assert.deepEqual(data.production, ctx.project.production); assert.deepEqual(data.cuts, ctx.project.cuts);
    assert.equal(Object.hasOwn(data, 'entities'), false);
    data.production.fixedPrompt = '调整风格';
    assert.equal(ctx.project.production!.fixedPrompt, '保留风格', 'read payload does not mutate stored notes');
    const changed = applyOperations(ctx.project, [{ operation: 'notes', value: data.production }]);
    assert.equal(changed.production!.fixedPrompt, '调整风格');
    assert.equal(changed.production!.promptText, ctx.project.production!.promptText);
    assert.deepEqual(changed.production!.sceneReferenceIds, ctx.project.production!.sceneReferenceIds);
});

test('metadata-only, scene, resources and empty selection keep distinct omission semantics', async () => {
    const { ctx, service } = fixture();
    const core = await service.call('director_read', { sections: [] });
    assert.equal(core.ok, true, core.error ?? 'read failed'); assert.equal(Object.hasOwn(core.data!, 'entities'), false);
    assert.equal(Object.hasOwn(core.data!, 'selection'), false);
    assert.equal(Object.hasOwn(core.data!, 'geometry'), false);
    const empty = await service.call('director_read', { ids: [] });
    assert.deepEqual((empty.data as any).entities, []);
    const scene = await service.call('director_read', { sections: ['scene', 'resources', 'references'] });
    assert.equal(scene.ok, true, scene.error ?? 'read failed');
    assert.deepEqual((scene.data as any).room, ctx.project.room);
    assert.equal(Object.hasOwn(scene.data!, 'production'), false);
    assert.equal(Object.hasOwn(scene.data!, 'resources'), true);
    const selection = await service.call('director_read', { sections: ['selection'] });
    assert.equal(selection.ok, true, selection.error ?? 'selection read failed');
    assert.equal(Object.hasOwn(selection.data!, 'selection'), true);
    assert.equal(Object.hasOwn(selection.data!, 'entities'), false);
    ctx.project.creationMode = 'geometry';
    const geometry = await service.call('director_read', { sections: [] });
    assert.equal(geometry.ok, true, geometry.error ?? 'geometry read failed');
    assert.equal(Object.hasOwn(geometry.data!, 'geometry'), true);
    assert.equal(Object.hasOwn(geometry.data!, 'selection'), false);
    const missing = await service.call('director_read', { resourceId: 'missing' });
    assert.equal(missing.ok, false); assert.match(missing.error!, /模型资源不存在/);
});

test('all is explicit and statistics run only when selected, independently of entity detail', async () => {
    const { ctx, service } = fixture(); let statisticsCalls = 0;
    const renderer = { info: { render: { frame: 1, calls: 1, triangles: 0 }, memory: { geometries: 0, textures: 0 } } };
    Object.defineProperty(ctx, 'engine', { value: { project: ctx.project, models: new Map(), roomGroup: new T.Group(),
        editorRenderer: renderer, shotRenderer: renderer, surfaces: { textures: { statistics() { statisticsCalls++; return { active: 0 }; } } } } });
    const all = await service.call('director_read', { sections: ['all'], details: true });
    assert.equal(all.ok, true, all.error ?? 'read failed');
    for (const key of ['entities', 'production', 'cuts', 'room', 'resources', 'media', 'resourceUsage', 'resourceStatistics', 'mediaRuntime']) assert.equal(Object.hasOwn(all.data!, key), true, key);
    assert.equal(statisticsCalls, 1);
    const stats = await service.call('director_read', { sections: ['statistics'] });
    assert.equal(stats.ok, true, stats.error ?? 'read failed'); assert.equal(statisticsCalls, 2);
    assert.equal(Object.hasOwn(stats.data!, 'entities'), false);
});

test('MCP and built-in assistant use the same validated section selector', () => {
    assert.deepEqual(MCP_TOOL_DEFINITIONS, TOOL_DEFINITIONS);
    validateToolInput('director_read', { sections: [] });
    validateToolInput('director_read', { sections: ['production', 'cuts'] });
    assert.throws(() => validateToolInput('director_read', { sections: ['typo'] }), /sections/);
    assert.throws(() => validateToolInput('director_read', { sections: 'all' }), /sections/);
});
