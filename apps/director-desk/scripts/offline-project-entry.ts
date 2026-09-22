import {mediaFromBytes} from '../src/media/offline-source.ts';
import {defaultSurfaceLayer} from '../src/media/model.ts';
export {mediaFromBytes} from '../src/media/offline-source.ts';
export {defaultSurfaceLayer,assertMediaResources,assertSurface,mediaTime} from '../src/media/model.ts';
export {defaultVisual,VISUAL_PRESETS,FIELD_TYPES,DEFORM_TYPES} from '../src/visuals/model.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ASSETS } from '../src/asset-catalog.ts';
import { queryAssetCatalog } from '../src/assets/catalog-query.ts';
import { ACTIONS, ASPECTS, FRAME_RATES, JOINTS, assertProject, entity, clip } from '../src/model.ts';
import { SCENE_TEMPLATES, createScene, type SceneTemplate } from '../src/scenes.ts';
import { parameterDefaults } from '../src/parametric-props.ts';
import { applyOperations, applyOperationsWithResources, type EditOperation } from '../src/automation/edits.ts';
import { validateToolInput } from '../src/automation/validate.ts';
import { assertSceneDocument, listDocumentScenes, projectForScene, readSceneDocument, updateDocumentScene } from '../src/scenes/sequence-project.ts';
import { continuitySummary } from '../src/scenes/continue-scene.ts';
import { editIndependentScene, readIndependentScene } from '../src/automation/scene-tools.ts';
export { packModelFiles, unpackModelFiles } from '../src/resources/model-package.ts';
export { modelResourceId } from '../src/resources/project-resources.ts';
export { resourceUsage } from '../src/resources/resource-usage.ts';
export { ResourceRecovery } from '../src/resources/resource-recovery.ts';
export { assertModelNodeEdits, assertModelNodeBindings } from '../src/resources/model-node-edits.ts';
export { nativeSample, nativeSourceTime } from '../src/resources/native-animation.ts';
export { retargetSample, canRetarget, crowdAnimationPhase } from '../src/resources/retarget-animation.ts';
export { HUMAN_BONES, REQUIRED_HUMAN_BONES, suggestHumanoidRig, rigStatus, assertRigDefinition } from '../src/resources/rig-definition.ts';
export { checkPathSurfaces, applyPathSurfaceCorrections, pathSurfaceSamples } from '../src/spatial/path-surfaces.ts';
export { structurePorts, worldStructurePorts } from '../src/building/structure-ports.ts';
export { syncStructureLinks, disconnectStructure } from '../src/building/structure-links.ts';
export { mergeScene } from '../src/scenes/merge-project.ts';
export { readSceneDocument, projectForScene, listDocumentScenes, addDocumentScene, duplicateDocumentScene, switchDocumentScene,
    renameDocumentScene, reorderDocumentScenes, removeDocumentScene, updateDocumentScene, projectForOrigin } from '../src/scenes/sequence-project.ts';
export { continuitySummary, sceneContentHash } from '../src/scenes/continue-scene.ts';
export { editIndependentScene, readIndependentScene } from '../src/automation/scene-tools.ts';
export { emptyEditorView, workingElevation, editorEntityVisible, assignUnsortedFloors, removeFloor, syncFloorElevations } from '../src/building/floors.ts';
export { applyHandBinding, editBoundTransform, detachHandBinding, canBindHand } from '../src/animation/hand-binding.ts';
export { contactAnchors, worldContactAnchors } from '../src/assets/contact-anchors.ts';
export { seatedPlacement } from '../src/editor/seat-placement.ts';
export { motionPresets } from '../src/animation/motion-catalog.ts';
export { GEOMETRY_ASSET_IDS, geometryCreationGuide } from '../src/assets/creation-mode.ts';
export { pathDistance } from '../src/animation/path-distance.ts';
export { motionTransitionAt } from '../src/animation/transition-plan.ts';
export { ASSETS, ACTIONS, ASPECTS, FRAME_RATES, JOINTS, SCENE_TEMPLATES, createScene, entity, clip, assertProject, applyOperations, applyOperationsWithResources, parameterDefaults, queryAssetCatalog };

async function read(file: string) { return JSON.parse(await fs.readFile(file, 'utf8')); }
async function write(file: string, data: unknown) {
    if ((data as { version?: unknown })?.version === 3) assertSceneDocument(data); else assertProject(data);
    const document = readSceneDocument(data), project = projectForScene(document);
    if (path.extname(file).toLowerCase() !== '.director') throw new Error('输出文件需要 .director 扩展名');
    await fs.writeFile(file, JSON.stringify(data, null, 2), { flag: 'wx' });
    console.log(JSON.stringify({ ok: true, name: document.name, scenes: document.scenes.length, entities: project.entities.length, cameras: project.entities.filter(e => e.kind === 'camera').length, duration: project.duration }));
}
async function main(args: string[]) {
    const [command, file, ...rest] = args;
    if(command==='import-media'){
        if(!file||rest.length<2||rest.length>3)throw Error('import-media 需要 输入.director 媒体文件 输出.director [承载对象ID]');
        const input=await read(file),doc=readSceneDocument(input),p=projectForScene(doc),source=rest[0];
        const mime=({'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.mp4':'video/mp4','.webm':'video/webm'} as Record<string,string>)[path.extname(source).toLowerCase()];
        if(!mime)throw Error('媒体扩展名不支持');const stat=await fs.stat(source);if(!stat.isFile()||stat.size>512*1024*1024)throw Error('媒体必须是 512 MB 内的文件');
        const resource=await mediaFromBytes(path.basename(source),mime,await fs.readFile(source));p.media??=[];if(!p.media.some(r=>r.id===resource.id))p.media.push(resource);
        if(rest[2]){const target=p.entities.find(e=>e.id===rest[2]);if(!target||target.locked)throw Error('承载对象不存在或已锁定');(target.surface??={layers:[]}).layers.push(defaultSurfaceLayer(resource.id));}
        await write(rest[1],input.version===3?updateDocumentScene(doc,doc.activeSceneId,p):p);return;
    }
    if (command === 'assets') {
        if (rest.length) throw new Error('assets 仅接受可选的查询.json 文件');
        const query = file ? await read(file) : {};
        validateToolInput('director_assets', query);
        console.log(JSON.stringify(queryAssetCatalog(query), null, 2)); return;
    }
    if (command === 'catalog') { console.log(JSON.stringify({ assets: ASSETS, templates: SCENE_TEMPLATES, actions: ACTIONS, joints: JOINTS, aspects: ASPECTS, frameRates: FRAME_RATES, parameters: parameterDefaults,
        entityDefaults: entity('actor', 'person', '人物'), cameraDefaults: entity('camera', 'camera', '摄影机').camera }, null, 2)); return; }
    if (command === 'create') {
        const options: Record<string, string> = {};
        if (!file || rest.length % 2) throw new Error('create 需要输出文件及 --选项 值');
        for (let i = 0; i < rest.length; i += 2) { if (!['--template', '--duration', '--fps', '--aspect', '--name'].includes(rest[i])) throw new Error('未知选项'); options[rest[i].slice(2)] = rest[i + 1]; }
        const template = options.template || 'blank'; if (!SCENE_TEMPLATES.some(t => t.id === template)) throw new Error('未知场景模板');
        const project = createScene(template as SceneTemplate);
        if (options.duration !== undefined) {
            const duration = Number(options.duration), factor = duration / project.duration;
            // Keep a timed template usable when its overall duration is requested to change.
            for (const e of project.entities) { e.path?.points.forEach(p => { p.time *= factor; }); e.poseKeys.forEach(k => { k.time *= factor; }); e.camera?.targetPath?.points.forEach(p => { p.time *= factor; }); e.clips.forEach(c => { c.start *= factor; c.end *= factor; }); }
            project.cuts.forEach(c => { c.time *= factor; }); project.duration = duration;
        }
        if (options.fps) project.fps = Number(options.fps); if (options.aspect) project.aspect = options.aspect; if (options.name) project.name = options.name;
        await write(file, project); return;
    }
    if (command === 'validate' || command === 'inspect') {
        if (!file || rest.length) throw new Error(command + ' 需要一个工程文件');
        const input = await read(file), document = readSceneDocument(input), p = projectForScene(document);
        const summary = { ok: true, name: p.name, duration: p.duration, fps: p.fps, aspect: p.aspect, entities: p.entities.length, cameras: p.entities.filter(e => e.kind === 'camera').length,
            note: '已通过文件结构和引用校验；未执行画面、遮挡或碰撞检查。' };
        console.log(JSON.stringify(input.version === 3 ? { ...summary, scenes: listDocumentScenes(document), ...(command === 'inspect' ? readIndependentScene(document) : {}) }
            : command === 'inspect' ? { ...summary, room: p.room, cuts: p.cuts, objects: p.entities, references: p.references.map(({ id, name }) => ({ id, name })), production: p.production } : summary, null, 2)); return;
    }
    if (command === 'apply') {
        if (!file || rest.length !== 2) throw new Error('apply 需要 输入.director 操作.json 输出.director');
        const input = await read(file), document = readSceneDocument(input), p = input.version === 3 ? projectForScene(document) : input; assertProject(p); const operations = await read(rest[0]);
        validateToolInput('director_apply', { revision: 1, requestId: 'offline', operations });
        const next = await applyOperationsWithResources(p, operations as EditOperation[]);
        await write(rest[1], input.version === 3 ? updateDocumentScene(document, document.activeSceneId, next) : next); return;
    }
    if (command === 'scene') {
        if (!file || rest.length < 1 || rest.length > 2) throw Error('scene 需要 输入.director 戏段操作.json [输出.director]');
        const document = readSceneDocument(await read(file)), operation = await read(rest[0]); validateToolInput('director_scene', operation);
        if (operation.action === 'list' || operation.action === 'read') {
            if (rest.length !== 1) throw Error('只读戏段查询不接受输出文件');
            console.log(JSON.stringify(operation.action === 'list' ? listDocumentScenes(document) : readIndependentScene(document, operation.sceneId), null, 2)); return;
        }
        if (operation.action === 'continue') throw Error('实际末帧接拍需要运行中的场景求值；请使用网页“从末帧接拍”或 MCP director_scene continue，离线不伪造姿态');
        if (rest.length !== 2) throw Error('戏段修改需要新的输出.director 文件');
        await write(rest[1], editIndependentScene(document, operation)); return;
    }
    if (command === 'continuity') {
        if (!file || rest.length > 1) throw Error('continuity 需要 工程.director [戏段ID]');
        console.log(JSON.stringify(await continuitySummary(readSceneDocument(await read(file)), rest[0]), null, 2)); return;
    }
    throw new Error('用法：assets [查询.json] | catalog | create 输出.director [--template blank --duration 10 --fps 24 --aspect 16:9 --name 场次] | validate 工程.director | inspect 工程.director | apply 输入.director 操作.json 输出.director | scene 输入.director 戏段操作.json [输出.director] | continuity 工程.director [戏段ID]');
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    main(process.argv.slice(2)).catch((error: Error & { code?: string }) => { console.error(JSON.stringify({ ok: false, error: error.code === 'EEXIST' ? '输出文件已存在，请使用新文件名保留原稿' : error.message })); process.exitCode = 1; });
}

export { footPlantPlans } from '../src/animation/foot-plant-plan.ts';
export { builtinFootPlant } from '../src/animation/motion-catalog.ts';

export { fitStride, applyStrideEstimate } from '../src/animation/stride-fit.ts';
