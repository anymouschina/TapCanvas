import { createScene, SCENE_TEMPLATES, type SceneTemplate } from '../scenes.ts';
import { addDocumentScene, duplicateDocumentScene, projectForScene, removeDocumentScene, renameDocumentScene, reorderDocumentScenes, switchDocumentScene, type SceneDocument } from '../scenes/sequence-project.ts';
import { inheritedPoseAt } from '../scenes/initial-pose.ts';

export function readIndependentScene(document: SceneDocument, id = document.activeSceneId) {
    const scene = document.scenes.find(s => s.id === id); if (!scene) throw Error('戏段不存在');
    const project = projectForScene(document, id);
    return { sceneId: id, sceneName: scene.name, active: id === document.activeSceneId,
        project: { ...project, media:project.media?.map(({data:_data,...metadata})=>metadata), resources: project.resources?.map(({ package: _package, ...metadata }) => metadata),
            references: project.references.map(({ id, name }) => ({ id, name })),
            entities: project.entities.map(e => ({ ...e, ...(e.initialPose ? { initialPose: { activeAtStart: inheritedPoseAt(e, 0), nodeCount: e.initialPose.nodes.length } } : {}) })) },
        origin: scene.origin ? { sceneId: scene.origin.sceneId, sceneName: scene.origin.sceneName, time: scene.origin.time, frameIndex: scene.origin.frameIndex } : null };
}
export function editIndependentScene(document: SceneDocument, args: Record<string, unknown>) {
    const id = String(args.sceneId ?? document.activeSceneId), name = String(args.name ?? ''), nextId = args.newSceneId as string | undefined;
    switch (args.action) {
        case 'switch': return switchDocumentScene(document, id);
        case 'copy': return duplicateDocumentScene(document, id, name, nextId);
        case 'rename': return renameDocumentScene(document, id, name);
        case 'remove': return removeDocumentScene(document, id);
        case 'reorder': return reorderDocumentScenes(document, args.sceneIds as string[]);
        case 'create': {
            const template = String(args.template ?? 'blank'); if (!SCENE_TEMPLATES.some(t => t.id === template)) throw Error('未知场景模板');
            return addDocumentScene(document, createScene(template as SceneTemplate), name, nextId);
        }
        default: throw Error('未知戏段编辑操作');
    }
}
