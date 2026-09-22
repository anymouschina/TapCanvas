import {freezeVisualState,receivesRootField} from '../visuals/continuity.ts';
import {entityPosition} from '../timeline.ts';
import type { Engine } from '../engine.ts';
import { assertProject, clone, getFrameCount } from '../model.ts';
import { activeCameraId } from '../timeline.ts';
import { collectSpatialReport } from '../spatial/report.ts';
import { captureInitialPose } from './initial-pose-runtime.ts';
import { stableSceneJson } from './initial-pose.ts';
import { addDocumentScene, assertSceneDocument, updateDocumentScene, type SceneDocument } from './sequence-project.ts';
import type { ContinuityOrigin } from './continuity-origin.ts';
import { freezeEndingCamera } from '../cinematography/continuity.ts';
import { numberAt } from '../animation/channels.ts';
import { lightIntensity } from '../lighting/model.ts';
import { lightColor } from '../lighting/runtime.ts';

export async function sceneContentHash(value: unknown) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableSceneJson(value)));
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
/** Capture through the exact playback evaluator, then restore the caller's frame before any async work. */
export async function continueScene(engine: Engine, document: SceneDocument, name: string, id: string = crypto.randomUUID()): Promise<SceneDocument> {
    assertSceneDocument(document);
    const source = document.scenes.find(s => s.id === document.activeSceneId)!;
    if (stableSceneJson(updateDocumentScene(document, source.id, engine.project)) !== stableSceneJson(document)) throw Error('当前画面与工程戏段不同，请重新读取后接拍');
    const project = clone(engine.project), frameIndex = getFrameCount(0, project.duration, project.fps) - 1, time = frameIndex / project.fps;
    const cameraId = activeCameraId(project, time), previous = engine.time;
    let objects: ContinuityOrigin['objects'];
    try {
        engine.sample(time);
        const report = collectSpatialReport(engine, cameraId, true);
        objects = report.objects.map(o => ({ key: o.key, entityId: o.entityId, memberIndex: o.memberIndex, name: o.name, kind: o.kind,
            position: o.origin, forward: o.forward, action: o.action, enabled: o.enabled, bounds: o.bounds ? { min: o.bounds.min, max: o.bounds.max } : null }));
        for (const entity of project.entities) {
            const root = engine.models.get(entity.id)!;
            entity.position = receivesRootField(entity,project,time)?entityPosition(entity,time).toArray():root.position.toArray(); entity.rotation = [root.rotation.x, root.rotation.y, root.rotation.z];
            entity.path = null; entity.face = 'fixed'; entity.faceTarget = ''; entity.clips = []; entity.pose = {}; entity.poseKeys = [];
            if (entity.kind === 'actor' || entity.kind === 'crowd' || entity.external) entity.initialPose = captureInitialPose(root, entity);
            if (entity.light) {
                entity.color = '#' + lightColor(entity, time).getHexString();
                entity.light.intensity = lightIntensity(entity.light, time); delete entity.light.temperature; delete entity.light.colorKeys; entity.light.flicker = null;
            }
            if (entity.camera) {
                const camera = engine.cameras.get(entity.id)!;
                entity.position = camera.position.toArray(); entity.rotation = [camera.rotation.x, camera.rotation.y, camera.rotation.z];
                if (entity.camera.targetPath) {
                    if (entity.camera.mode !== 'pov' && (entity.camera.mode === 'follow' || entity.camera.aim === 'target')) {
                        entity.camera.mode = 'free'; entity.camera.aim = 'manual'; entity.camera.targetId = '';
                    }
                    entity.camera.targetPath = null;
                }
                freezeEndingCamera(entity, camera, time, engine.models.get(entity.camera.targetId));
            }
        }
        for(const e of project.entities)freezeVisualState(e,project,time);
        project.cuts = [{ time: 0, cameraId }];
        if (project.lighting) {
            for (const key of ['ambient', 'exposure', 'sunIntensity'] as const) if (project.lighting[key] !== undefined) project.lighting[key] = numberAt(project.lighting[key], time);
            if (project.lighting.fog) project.lighting.fog.density = numberAt(project.lighting.fog.density, time);
        }
        if (project.production) { project.production.notes = []; delete project.production.promptText; }
        assertProject(project);
    } finally { engine.sample(previous); }
    const next = addDocumentScene(document, project, name, id), scene = next.scenes.find(s => s.id === id)!;
    scene.origin = { version: 1, sceneId: source.id, sceneName: source.name, sourceHash: await sceneContentHash(source.state), frameIndex, time,
        fps: source.state.fps, duration: source.state.duration, state: clone(scene.state), notes: clone(source.state.production?.notes ?? []), objects, cameraId };
    assertSceneDocument(next); return next;
}

/** Immutable inheritance evidence is separate from a source scene subsequently edited or removed. */
export async function continuitySummary(document: SceneDocument, id = document.activeSceneId) {
    assertSceneDocument(document);
    const scene = document.scenes.find(s => s.id === id); if (!scene) throw Error('戏段不存在');
    if (!scene.origin) return { sceneId: id, origin: null };
    const origin = scene.origin, source = document.scenes.find(s => s.id === origin.sceneId);
    return { sceneId: id, origin: { sceneId: origin.sceneId, sceneName: origin.sceneName, frameIndex: origin.frameIndex, time: origin.time, fps: origin.fps, duration: origin.duration,
        sourceStatus: !source ? 'deleted' : await sceneContentHash(source.state) === origin.sourceHash ? 'unchanged' : 'changed',
        cameraId: origin.cameraId, notes: clone(origin.notes.filter(note => note.start <= origin.time)).map(note => ({ ...note, timing: note.end <= origin.duration ? 'within-source' : 'continues-beyond-source' })),
        notStartedNotes: clone(origin.notes.filter(note => note.start > origin.time)), objects: clone(origin.objects),
        description: '以下为接拍当时保存的来源末帧，不随前段之后的编辑或删除改变。notStartedNotes 尚未到开始时间，不算已发生前情；跨出场景时长的备注保留完整文字并单独标记。位置以米计，世界 +Y 向上；enabled 按来源成片机位的显示状态记录。' } };
}
