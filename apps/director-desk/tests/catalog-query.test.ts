import test from 'node:test';
import assert from 'node:assert/strict';
import { ASSETS, findAsset } from '../src/asset-catalog.ts';
import { queryAssetCatalog } from '../src/assets/catalog-query.ts';
import { createToolService } from '../src/automation/service.ts';
import { demoProject } from '../src/model.ts';
import type { AppContext } from '../src/app-context.ts';

test('empty searches and genuine misses return no fallback catalog or unrelated actions', () => {
    for (const query of [{}, { details: true }, { query: '   ' }, { ids: [] }, { offset: 8 }]) {
        const result = queryAssetCatalog(query);
        assert.equal(result.found, false); assert.equal(result.total, 0);
        assert.deepEqual(result.assets, []); assert.deepEqual(result.groups, []);
        assert.deepEqual(result.actions, {}); assert.equal(result.nextOffset, null);
        assert.match(result.message, /指定/);
    }
    const miss = queryAssetCatalog({ query: '不存在的量子传送门白模' });
    assert.equal(miss.found, false); assert.deepEqual(miss.missingQueries, ['不存在的量子传送门白模']);
    assert.match(miss.message, /没有找到/);
    const partial = queryAssetCatalog({ queries: ['blackboard', '不存在的量子传送门白模'], limit: 1 });
    assert.equal(partial.found, true); assert.equal(partial.assets[0].id, 'furniture-blackboard');
    assert.deepEqual(partial.missingQueries, ['不存在的量子传送门白模']);
    assert.deepEqual(partial.actions, {});
    assert.equal(queryAssetCatalog({ kind: 'prop' }).assets.length, 8);
});

test('bounded catalog pages cover every asset exactly once, with explicit end and missing IDs', () => {
    const first = queryAssetCatalog({ group: '全部', limit: 20 }); assert.equal(first.assets.length, 20); assert.equal(first.total, ASSETS.length);
    const ids: string[] = []; let offset: number | null = 0;
    while (offset !== null) { const page = queryAssetCatalog({ group: '全部', offset, limit: 17 }); ids.push(...page.assets.map(a => a.id)); offset = page.nextOffset; }
    assert.deepEqual(ids, ASSETS.map(a => a.id)); assert.equal(new Set(ids).size, ASSETS.length);
    const end = queryAssetCatalog({ group: '全部', offset: ASSETS.length + 100 }); assert.deepEqual(end.assets, []); assert.equal(end.nextOffset, null);
    assert.deepEqual(queryAssetCatalog({ ids: ['absent', 'person', 'absent'] }).missingIds, ['absent']);
    for (const query of [{ limit: 0 }, { limit: 51 }, { limit: 1.5 }, { offset: -1 }, { offset: Infinity }, { offset: 0.1 }]) assert.throws(() => queryAssetCatalog(query));
    assert.ok(JSON.stringify(first).length < JSON.stringify(ASSETS).length / 3);
});
test('name and alias search intersects category, species rig and supported action filters', () => {
    assert.deepEqual(queryAssetCatalog({ query: '  DOG  ', group: '宠物', rig: 'quadruped', action: 'idle' }).assets.map(a => a.id), ['animal-dog-small', 'animal-dog-large']);
    assert.equal(queryAssetCatalog({ query: 'dog', action: 'walk' }).total, 0, 'static animal paths are not advertised as walking');
    assert.ok(queryAssetCatalog({ rig: 'human-legacy', action: 'walk' }).assets.some(a => a.id === 'person'));
    assert.equal(queryAssetCatalog({ group: '交通工具', kind: 'actor' }).total, 0);
    assert.equal(queryAssetCatalog({ query: '公交', group: '交通工具' }).assets[0]?.id, 'vehicle-bus');
});

test('alternative asset queries return a deduplicated union with normal filters and pagination', () => {
    const result = queryAssetCatalog({ queries: ['blackboard', 'lectern', 'desk', 'blackboard'], kind: 'prop' });
    for (const id of ['furniture-blackboard', 'furniture-lectern', 'furniture-desk']) assert.ok(result.assets.some(a => a.id === id));
    assert.equal(new Set(result.assets.map(a => a.id)).size, result.assets.length);
    assert.equal(queryAssetCatalog({ query: 'blackboard lectern' }).total, 0, 'legacy query still requires all words');
    assert.equal(queryAssetCatalog({ queries: ['blackboard', 'lectern'], query: 'blackboard' }).total, 1);
    assert.equal(queryAssetCatalog({ queries: ['desk'], kind: 'actor' }).total, 0);
    assert.equal(queryAssetCatalog({ queries: ['blackboard', 'lectern'], limit: 1 }).nextOffset, 1);
    assert.throws(() => queryAssetCatalog({ queries: [''] }), /queries/);
    assert.throws(() => queryAssetCatalog({ group: 'invented' }), /可用 group/);
});
test('detail returns real parameter and species joint contracts without exposing mutable catalog state', () => {
    const result = queryAssetCatalog({ ids: ['vehicle-bus', 'animal-fish'], details: true });
    const bus = result.assets.find(a => a.id === 'vehicle-bus')!;
    assert.ok('parameters' in bus); assert.deepEqual(bus.parameters, findAsset('vehicle-bus')!.parameters);
    const fish = result.assets.find(a => a.id === 'animal-fish')!;
    assert.ok(fish && 'joints' in fish && fish.joints && 'leftFin' in fish.joints && !('leftArm' in fish.joints));
    bus.parameters!.width.default = 999;
    assert.notEqual(findAsset('vehicle-bus')!.parameters!.width.default, 999);
    assert.equal('parameters' in queryAssetCatalog({ ids: ['vehicle-bus'] }).assets[0], false);
});
test('shared tool service validates catalog requests and returns useful filters without changing project', async () => {
    const project = demoProject(), before = JSON.stringify(project);
    const service = createToolService({ project } as AppContext);
    const response = await service.call('director_assets', { query: '公交', details: true });
    assert.equal(response.ok, true);
    assert.equal(await service.call('director_assets', { limit: 1.5 }).then(r => r.ok), false);
    assert.equal(await service.call('director_assets', { rig: 'invented' }).then(r => r.ok), false);
    assert.equal(await service.call('director_assets', { unknown: true }).then(r => r.ok), false);
    assert.equal(JSON.stringify(project), before);
});


test('catalog add examples really validate and expose unambiguous patch destinations', async () => {
    const { applyOperations } = await import('../src/automation/edits.ts');
    for (const asset of ASSETS) {
        const detail = queryAssetCatalog({ ids: [asset.id], details: true }).assets[0];
        assert.ok('addExample' in detail);
        const next = applyOperations(demoProject(), [detail.addExample as import('../src/automation/edits.ts').EditOperation]);
        assert.equal(next.entities.at(-1)?.asset, asset.id);
        assert.equal(detail.parameterPatchField, asset.parameters ? 'assetParameters' : ['stairs', 'road', 'wall', 'ground'].includes(asset.id) ? 'parameters' : null);
        assert.equal('kind' in detail.addExample, false);
    }
});

test('preview add plus motion is atomic, does not create live IDs, and commit reports persistence', async () => {
    let commits = 0;
    const ctx = { project: demoProject(), get revision(){return commits;}, playing: false, busy: false, draft: null,
        history: { pending: false, undoStack: [], redoStack: [] },
        engine: { exporting: false, externalModels: { prepare: async () => {}, assertReady() {}, retain() {} } },
        updateTimeUI() {}, change(fn: () => void) { fn(); commits++; return true; },
    } as unknown as AppContext;
    const service = createToolService(ctx), original = JSON.stringify(ctx.project);
    const read = await service.call('director_read'); assert.equal(read.ok, true);
    const revision = (read.data as { revision: number }).revision;
    const operations = [{ operation: 'add', asset: 'person', id: 'preview-actor' },
        { operation: 'motion', id: 'preview-actor', asset: 'basic-sit', time: 0 }];
    const preview = await service.call('director_apply', { revision, requestId: 'preview', preview: true, operations });
    assert.equal(preview.ok, true, preview.error ?? 'preview failed');
    const report = preview.data as { preview: boolean; committed: boolean; revision: number; message: string };
    assert.equal(report.preview, true); assert.equal(report.committed, false); assert.equal(report.revision, revision);
    assert.match(report.message, /未写入/); assert.equal(commits, 0); assert.equal(JSON.stringify(ctx.project), original);
    const separate = await service.call('director_apply', { revision, requestId: 'separate', preview: true, operations: [operations[1]] });
    assert.equal(separate.ok, false); assert.match(separate.error!, /operations\[0\].*不存在/);
    const result = await service.call('director_apply', { revision, requestId: 'commit', preview: false, operations });
    assert.equal(result.ok, true, result.error ?? 'commit failed'); assert.equal((result.data as { committed: boolean }).committed, true);
    assert.equal(commits, 1); assert.ok(ctx.project.entities.find(e => e.id === 'preview-actor')?.clips.some(c => c.action === 'sit'));
    const repeated = await service.call('director_apply', { revision, requestId: 'commit', preview: false, operations });
    assert.equal(repeated.ok, true); assert.equal(commits, 1);
});
