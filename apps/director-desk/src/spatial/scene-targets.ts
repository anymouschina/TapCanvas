import { Mesh, Object3D } from 'three';
import { isAnimalAsset } from '../asset-catalog.ts';
import type { Engine } from '../engine.ts';
import { shotEntityVisible } from '../scenes/camera-visibility.ts';
import { modelNodeHidden } from '../resources/model-node-visibility.ts';
export interface SceneTarget { key: string; entityId: string | null; name: string; root: Object3D; meshes: Mesh[]; head?: Object3D; person: boolean }
export function meshesOf(root: Object3D, exclude?: Object3D): Mesh[] {
    const meshes: Mesh[] = [];
    function visit(node: Object3D) { if (node === exclude || modelNodeHidden(node)) return; if (node instanceof Mesh) meshes.push(node); node.children.forEach(visit); }
    visit(root); return meshes;
}
/** Visibility flags from the editor preview are intentionally ignored; project state is authoritative. */
export function sceneTargets(engine: Engine, cameraId?: string): SceneTarget[] {
    const targets: SceneTarget[] = [], config = cameraId === undefined ? null : engine.cameraEntity(cameraId).camera!;
    for (const e of engine.project.entities) {
        if (e.kind === 'camera' || e.light || !shotEntityVisible(engine.project, e, config)) continue;
        if (e.kind === 'crowd') {
            engine.crowdRigs.get(e.id)!.forEach((rig, index) => targets.push({ key: `crowd:${e.id}:${index}`, entityId: e.id,
                name: `${e.name} / 第 ${index + 1} 人`, root: rig.root, meshes: meshesOf(rig.root), head: rig.head, person: true }));
        } else {
            const root = engine.models.get(e.id)!, rig = engine.rigs.get(e.id);
            const exclude = config?.mode === 'pov' && config.targetId === e.id ? rig?.head : undefined;
            targets.push({ key: `entity:${e.id}`, entityId: e.id, name: e.name, root, meshes: meshesOf(root, exclude), head: exclude ? undefined : rig?.head, person: e.kind === 'actor' && !isAnimalAsset(e.asset) });
        }
    }
    if (engine.project.room.enabled) {
        for (const [side, root] of engine.walls) if (!config?.hideWalls.includes(side)) targets.push({ key: `room:${side}`, entityId: null,
            name: ({ north: '北墙', south: '南墙', east: '东墙', west: '西墙', ceiling: '天花板' } as Record<string, string>)[side], root, meshes: meshesOf(root), person: false });
        const walls = new Set<Object3D>(engine.walls.values());
        const root = engine.roomGroup.children.find(node => !walls.has(node));
        if (root) targets.push({ key: 'room:floor', entityId: null, name: '房间地板', root, meshes: meshesOf(root), person: false });
    }
    return targets;
}
