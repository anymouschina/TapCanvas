import test from 'node:test';
import assert from 'node:assert/strict';
import { demoProject, validateProject } from '../src/model.ts';
import { entityPosition } from '../src/timeline.ts';
import { GEOMETRY_ASSET_IDS, geometryCreationGuide } from '../src/assets/creation-mode.ts';
import { queryAssetCatalog } from '../src/assets/catalog-query.ts';
import { applyOperations, changeSummary } from '../src/automation/edits.ts';
import { createToolService } from '../src/automation/service.ts';
import { MCP_TOOL_DEFINITIONS, TOOL_DEFINITIONS, FULL_TOOL_DEFINITIONS } from '../src/automation/contract.ts';
import { readSceneDocument, projectForScene, duplicateDocumentScene, updateDocumentScene } from '../src/scenes/sequence-project.ts';
import type { AppContext } from '../src/app-context.ts';

test('creation policy persists per scene without converting objects and rejects invalid modes', () => {
    const original = demoProject();
    assert.equal(original.creationMode, undefined);
    const geometry = applyOperations(original, [{ operation: 'project', patch: { creationMode: 'geometry', referenceLabels: true } }]);
    assert.deepEqual(geometry.entities, original.entities); assert.deepEqual(geometry.cuts, original.cuts);
    assert.equal(changeSummary(original, geometry).projectChanged, true);
    let doc = readSceneDocument(geometry);
    const sourceId = doc.activeSceneId;
    doc = duplicateDocumentScene(doc, sourceId, '第二场', 'second');
    doc = updateDocumentScene(doc, 'second', applyOperations(projectForScene(doc), [{ operation: 'project', patch: { creationMode: 'full', referenceLabels: false } }]));
    const saved = readSceneDocument(JSON.parse(JSON.stringify(doc)));
    assert.equal(projectForScene(saved).creationMode, 'full');
    assert.equal(projectForScene(saved, sourceId).creationMode, 'geometry');
    assert.equal(projectForScene(saved).referenceLabels, false);
    assert.equal(projectForScene(saved, sourceId).referenceLabels, true);
    assert.deepEqual(projectForScene(saved, sourceId).entities, original.entities);
    assert.throws(() => validateProject({ ...original, creationMode: 'display' }), /创作模式/);
    assert.throws(() => validateProject({ ...original, referenceLabels: 'yes' }), /标签/);
});

test('geometry discovery is scoped and its shape guide creates valid actual geometry', () => {
    const guide = geometryCreationGuide();
    assert.deepEqual(guide.assets.map(a => a.id), [...GEOMETRY_ASSET_IDS]);
    for (const { id } of guide.assets) {
        const p = applyOperations(demoProject(), [{ operation: 'add', asset: id, patch: { assetParameters: { width: .6, height: 1.8, depth: .5 }, color: '#336699' } }]);
        const e = p.entities.at(-1)!;
        assert.equal(e.kind, 'prop'); assert.equal(e.assetParameters!.height, 1.8);
    }
    assert.deepEqual(queryAssetCatalog({ group: '全部', limit: 50 }, GEOMETRY_ASSET_IDS).assets.map(a => a.id), [...GEOMETRY_ASSET_IDS]);
    const missing = queryAssetCatalog({ ids: ['person', 'shape-box'] }, GEOMETRY_ASSET_IDS);
    assert.deepEqual(missing.missingIds, ['person']); assert.equal(missing.assets.length, 1);
});

test('geometry mode reads only requested shape parameters and applies structural values', async () => {
    const project = { ...demoProject(), creationMode: 'geometry' as const };
    const service = createToolService({ project } as AppContext);
    const result = await service.call('director_assets', { ids: ['shape-arc'], details: true });
    assert.equal(result.ok, true, result.error ?? 'targeted shape query failed');
    const data = result.data as ReturnType<typeof queryAssetCatalog>;
    assert.deepEqual(data.assets.map(asset => asset.id), ['shape-arc']);
    assert.equal(data.total, 1); assert.equal(data.nextOffset, null);
    const arc = data.assets[0];
    assert.equal(arc.parameterPatchField, 'assetParameters');
    assert.deepEqual(arc.capabilities.actions, []);
    assert.ok('parameters' in arc && arc.parameters);
    for (const key of ['angle', 'thickness', 'segments']) assert.ok(arc.parameters[key], key);
    const parameters = { width: 4, height: 3, depth: .5, angle: 120, thickness: .2, segments: 36 };
    const edited = applyOperations(project, [{ operation: 'add', asset: arc.id, id: 'arc', patch: { assetParameters: parameters } }]);
    const entity = edited.entities.find(item => item.id === 'arc')!;
    assert.equal(entity.kind, 'prop');
    for (const [key, value] of Object.entries(parameters)) assert.equal(entity.assetParameters![key], value);
    assert.equal(project.entities.some(item => item.id === 'arc'), false);
});

test('read then direct batch builds geometric blocking, camera and saved prompt without catalog or preview', async () => {
    let revision=0;
    const ctx = { project: { ...demoProject(), creationMode: 'geometry' }, get revision(){return revision;}, playing: false, busy: false, draft: null,
        history: { pending: false, undoStack: [], redoStack: [] },
        engine: { exporting: false, externalModels: { prepare: async () => {}, assertReady() {}, retain() {} } },
        updateTimeUI() {}, change(fn: () => void) { fn(); revision++; return true; },
    } as unknown as AppContext;
    const service = createToolService(ctx);
    const read = await service.call('director_read'); assert.equal(read.ok, true);
    const data = read.data as { revision: number; creationMode: string; geometry: ReturnType<typeof geometryCreationGuide> };
    assert.equal(data.creationMode, 'geometry'); assert.equal(data.geometry.assets.length, GEOMETRY_ASSET_IDS.length);
    const operations = [
        ...['first', 'second'].map((id, i) => ({ operation: 'add', asset: 'shape-capsule', id, name: `角色${i + 1}`, patch: {
            color: i ? '#222222' : '#44AA66', assetParameters: { width: .5, height: 1.8, depth: .5 },
            path: { smooth: false, points: [{ time: 0, position: [i, 0, 0] }, { time: 10, position: [i, 0, -30] }] },
        } })),
        { operation: 'add', asset: 'shape-box', id: 'wall', patch: { assetParameters: { width: .2, height: 3, depth: 40 } } },
        { operation: 'add', asset: 'camera', id: 'tracking-camera', position: [4, 2, 3], patch: { camera: { focal: 24, targetId: 'first' } } },
        { operation: 'project', patch: { duration: 10 } },
        { operation: 'cuts', value: [{ time: 0, cameraId: 'tracking-camera' }] },
        { operation: 'notes', value: { fixedPrompt: '', sceneReferenceIds: [], notes: [{ id: 'plot', start: 0, end: 10, actorId: '', story: '角色1沿通道奔跑，角色2紧追。', emotion: '紧张', dialogue: '', action: '追逐' }], promptText: '本场参考视频（待上传）。绿色胶囊为角色1，黑色胶囊为角色2。保留空间关系和运镜，动作自然演绎。cut1 [00:00—00:10] 角色1奔跑逃离，角色2紧追。' } },
    ];
    const result = await service.call('director_apply', { revision: data.revision, requestId: 'geometry-build', operations });
    assert.equal(result.ok, true, result.error ?? 'build failed');
    const committed = result.data as { revision: number; committed: boolean };
    assert.equal(committed.committed, true);
    assert.deepEqual(entityPosition(ctx.project.entities.find(e => e.id === 'first')!, 5).toArray(), [0, 0, -15]);
    assert.equal(ctx.project.production!.notes[0].actorId, '');
    assert.ok(ctx.project.production!.promptText);
    const correction = await service.call('director_apply', { revision: committed.revision, requestId: 'geometry-correct', operations: [{ operation: 'update', id: 'wall', patch: { position: [3, 0, -20] } }] });
    assert.equal(correction.ok, true, correction.error ?? 'correction failed');
    const missing = await service.call('director_assets', { query: 'person' });
    assert.equal((missing.data as { found: boolean }).found, false);
});

test('MCP exposes concise compatible schemas and retains advanced help', () => {
    assert.deepEqual(MCP_TOOL_DEFINITIONS, TOOL_DEFINITIONS);
    assert.ok(JSON.stringify(MCP_TOOL_DEFINITIONS).length < JSON.stringify(FULL_TOOL_DEFINITIONS).length * .65);
    assert.ok(MCP_TOOL_DEFINITIONS.some(t => t.name === 'director_help'));
});
