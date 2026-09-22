import {assertMediaResources,type MediaResource} from '../media/model.ts';
import { assertProject, clone, type Project } from '../model.ts';
import { assertModelResources, type ModelResource } from '../resources/project-resources.ts';
import { assertLockedEntitiesUnchanged } from '../editor/invariants.ts';
import { assertContinuityOrigin, type ContinuityOrigin } from './continuity-origin.ts';

/** Version 3 is the whole production document. The renderer still receives one ordinary Project. */
export interface SceneDocument {
    format: 'director-desk';
    version: 3;
    name: string;
    activeSceneId: string;
    resources: ModelResource[];
    media?: MediaResource[];
    scenes: SceneEntry[];
}
export interface SceneEntry { id: string; name: string; state: SceneState; origin?: ContinuityOrigin }
export type SceneState = Pick<Project, 'duration' | 'fps' | 'aspect' | 'room' | 'entities' | 'cuts' | 'references' | 'production' | 'floors' | 'zones' | 'editorView' | 'creationMode' | 'referenceLabels' | 'lighting'>;
const stateKeys = ['duration', 'fps', 'aspect', 'room', 'entities', 'cuts', 'references', 'production', 'floors', 'zones', 'editorView', 'creationMode', 'referenceLabels', 'lighting'] as const;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const validId = (id: unknown): id is string => typeof id === 'string' && /^[\p{L}\p{N}_:.-]{1,200}$/u.test(id);
const validName = (name: unknown): name is string => typeof name === 'string' && name.trim().length > 0 && name.length <= 200;

function stateOf(project: Project): SceneState {
    return Object.fromEntries(stateKeys.filter(key => project[key] !== undefined).map(key => [key, clone(project[key])])) as unknown as SceneState;
}
function projection(document: SceneDocument, scene: SceneEntry): Project {
    return { format: 'director-desk', version: 2, name: document.name, resources: document.resources, ...(document.media?.length?{media:document.media}:{}), ...scene.state };
}

/** All scene references are checked against their own scene, with one shared source catalog. */
export function assertSceneDocument(input: unknown): asserts input is SceneDocument {
    if (!record(input) || input.format !== 'director-desk' || input.version !== 3
        || Object.keys(input).some(key => !['format', 'version', 'name', 'activeSceneId', 'resources', 'media', 'scenes'].includes(key))) throw Error('多戏段工程格式无效');
    const document = input as unknown as SceneDocument;
    if (typeof document.name !== 'string' || document.name.length > 200 || !Array.isArray(document.scenes) || !document.scenes.length || !Array.isArray(document.resources)) throw Error('多戏段工程需要名称、戏段及资源列表');
    assertModelResources({ version: 2, resources: document.resources } as Project);
    assertMediaResources(document.media);
    const ids = new Set<string>();
    for (const scene of document.scenes) {
        if (!record(scene) || Object.keys(scene).some(key => !['id', 'name', 'state', 'origin'].includes(key)) || !validId(scene.id) || ids.has(scene.id) || !validName(scene.name)) throw Error('戏段标识重复、名称或结构无效');
        if (!record(scene.state) || Object.keys(scene.state).some(key => !(stateKeys as readonly string[]).includes(key))) throw Error('戏段内容不能包含嵌套工程、源资源或未知字段');
        ids.add(scene.id); assertProject(projection(document, scene));
        if (scene.origin !== undefined) {
            assertContinuityOrigin(scene.origin);
            if (!record(scene.origin.state) || Object.keys(scene.origin.state).some(key => !(stateKeys as readonly string[]).includes(key))) throw Error('接拍快照不能包含嵌套工程');
            const frozen = { ...projection(document, scene), ...scene.origin.state };
            assertProject(frozen);
            if (frozen.fps !== scene.origin.fps || frozen.duration !== scene.origin.duration) throw Error('接拍快照时间基准不一致');
            assertProject({ ...frozen, production: { ...frozen.production, fixedPrompt: frozen.production?.fixedPrompt ?? '', sceneReferenceIds: frozen.production?.sceneReferenceIds ?? [], notes: scene.origin.notes } });
            if (!frozen.entities.some(e => e.kind === 'camera' && e.id === scene.origin!.cameraId)) throw Error('接拍快照机位不存在');
        }
    }
    if (!validId(document.activeSceneId) || !ids.has(document.activeSceneId)) throw Error('当前戏段不存在');
}

/** File boundary: legacy projects become one scene; input and output never share mutable arrays. */
export function readSceneDocument(input: unknown): SceneDocument {
    if (record(input) && input.version === 3) { assertSceneDocument(input); return clone(input); }
    assertProject(input);
    if (Object.keys(input).some(key => ![...stateKeys, 'format', 'version', 'name', 'resources', 'media'].includes(key))) throw Error('旧工程包含未识别字段，不能静默丢弃后迁移');
    const document: SceneDocument = { format: 'director-desk', version: 3, name: input.name, activeSceneId: 'scene-main', resources: clone(input.resources ?? []), ...(input.media?.length?{media:clone(input.media)}:{}),
        scenes: [{ id: 'scene-main', name: '第一场', state: stateOf(input) }] };
    assertSceneDocument(document); return document;
}
export function projectForScene(document: SceneDocument, id = document.activeSceneId): Project {
    assertSceneDocument(document);
    const scene = document.scenes.find(scene => scene.id === id); if (!scene) throw Error('戏段不存在');
    return clone(projection(document, scene));
}
export function projectForOrigin(document: SceneDocument, id: string): Project {
    assertSceneDocument(document);
    const scene = document.scenes.find(scene => scene.id === id); if (!scene?.origin) throw Error('戏段没有接拍来源');
    return clone({ ...projection(document, scene), ...scene.origin.state });
}
export function listDocumentScenes(document: SceneDocument) {
    assertSceneDocument(document);
    return document.scenes.map(scene => ({ id: scene.id, name: scene.name, active: scene.id === document.activeSceneId, duration: scene.state.duration, fps: scene.state.fps,
        entities: scene.state.entities.length, people: scene.state.entities.reduce((sum, e) => sum + (e.kind === 'crowd' ? e.count : e.kind === 'actor' ? 1 : 0), 0),
        cameras: scene.state.entities.filter(e => e.kind === 'camera').length }));
}
function commit(document: SceneDocument, edit: (next: SceneDocument) => void): SceneDocument {
    assertSceneDocument(document); const next = clone(document); edit(next); assertSceneDocument(next); return next;
}
export function switchDocumentScene(document: SceneDocument, id: string): SceneDocument {
    return commit(document, next => { if (!next.scenes.some(scene => scene.id === id)) throw Error('戏段不存在'); next.activeSceneId = id; });
}
export function renameDocumentScene(document: SceneDocument, id: string, name: string): SceneDocument {
    return commit(document, next => { const scene = next.scenes.find(scene => scene.id === id); if (!scene) throw Error('戏段不存在'); scene.name = name; });
}
export function reorderDocumentScenes(document: SceneDocument, ids: string[]): SceneDocument {
    return commit(document, next => {
        if (!Array.isArray(ids) || ids.length !== next.scenes.length || new Set(ids).size !== ids.length || ids.some(id => !next.scenes.some(scene => scene.id === id))) throw Error('戏段排序必须恰好包含全部戏段');
        next.scenes = ids.map(id => next.scenes.find(scene => scene.id === id)!);
    });
}
export function removeDocumentScene(document: SceneDocument, id: string): SceneDocument {
    return commit(document, next => {
        const index = next.scenes.findIndex(scene => scene.id === id); if (index < 0) throw Error('戏段不存在');
        if (next.scenes.length === 1) throw Error('工程至少保留一个戏段');
        next.scenes.splice(index, 1);
        if (next.activeSceneId === id) next.activeSceneId = next.scenes[Math.min(index, next.scenes.length - 1)].id;
    });
}

/** Copying preserves entity IDs as cross-scene identities; it does not sample an ending pose. */
export function duplicateDocumentScene(document: SceneDocument, sourceId: string, name: string, id: string = crypto.randomUUID()): SceneDocument {
    return commit(document, next => {
        const source = next.scenes.find(scene => scene.id === sourceId); if (!source) throw Error('来源戏段不存在');
        next.scenes.push({ ...clone(source), id, name }); next.activeSceneId = id;
    });
}

/** Add an independent ordinary scene, merging immutable sources by content identity. */
export function addDocumentScene(document: SceneDocument, project: Project, name: string, id: string = crypto.randomUUID()): SceneDocument {
    assertProject(project);
    return commit(document, next => {
        for (const resource of project.resources ?? []) {
            const previous = next.resources.find(r => r.id === resource.id);
            if (previous && JSON.stringify(previous.package) !== JSON.stringify(resource.package)) throw Error('同一资源标识对应不同内容');
            if (!previous) next.resources.push(clone(resource));
        }
        next.media=mergeMedia(next.media,project.media);
        next.scenes.push({ id, name, state: stateOf(project) }); next.activeSceneId = id;
    });
}

/** Commit the active editor projection. Deleting a source still used by another scene fails atomically. */
export function updateDocumentScene(document: SceneDocument, id: string, project: Project): SceneDocument {
    assertSceneDocument(document);
    return clone(updateValidatedDocumentScene(document, id, project));
}

/** Session boundary: input is already validated and privately owned. Keep unchanged scene snapshots
 * shared internally; callers exposing the result outside their owner must clone it first. */
export function updateValidatedDocumentScene(document: SceneDocument, id: string, project: Project): SceneDocument {
    assertProject(project);
    const scene = document.scenes.find(scene => scene.id === id); if (!scene) throw Error('戏段不存在');
    assertLockedEntitiesUnchanged(projection(document, scene), project);
    const resourcesChanged = JSON.stringify(document.resources) !== JSON.stringify(project.resources ?? []);
    if (resourcesChanged) {
        for (const resource of project.resources ?? []) {
            const previous = document.resources.find(r => r.id === resource.id);
            if (previous && JSON.stringify(previous.package) !== JSON.stringify(resource.package)) throw Error('共享源资源内容不可原地改写，请使用新的资源标识');
        }
    }
    const media=mergeMedia(document.media,project.media);
    const next: SceneDocument = { ...document, name: project.name, ...(media.length?{media}:{}),
        resources: resourcesChanged ? clone(project.resources ?? []) : document.resources,
        scenes: document.scenes.map(entry => entry.id === id ? { ...entry, state: stateOf(project) } : entry) };
    // Shared catalog changes can invalidate inactive scenes and frozen continuity snapshots.
    if (resourcesChanged) assertSceneDocument(next);
    return next;
}

function mergeMedia(existing:MediaResource[]=[],incoming:MediaResource[]=[]):MediaResource[]{
 const result=[...existing];for(const r of incoming){const previous=result.find(p=>p.id===r.id);if(previous&&(previous.data!==r.data||previous.mime!==r.mime||previous.width!==r.width||previous.height!==r.height||previous.duration!==r.duration))throw Error('媒体源内容不可原地改写，请重新导入');if(!previous)result.push({...r});}return result;
}
