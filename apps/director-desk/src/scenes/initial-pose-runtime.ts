import type { Mesh, Object3D } from 'three';
import type { Entity } from '../model.ts';
import { inheritedPoseAt, poseLayout, type InitialPose, type PoseNode } from './initial-pose.ts';

export function poseNodes(root: Object3D) {
    const nodes = new Map<string, Object3D>();
    const walk = (parent: Object3D, prefix = '') => parent.children.forEach((node, i) => { if (node.userData.directorPoseHelper) return; const path = prefix ? `${prefix}/${i}` : String(i); nodes.set(path, node); walk(node, path); });
    walk(root); return nodes;
}
function read(nodes: Map<string, Object3D>): PoseNode[] {
    return [...nodes].map(([path, node]) => ({ path, position: node.position.toArray(), quaternion: node.quaternion.toArray(), scale: node.scale.toArray(), visible: node.visible,
        ...(!node.matrixAutoUpdate ? { matrix: Array.from(node.matrix.elements) } : {}),
        ...((node as Mesh).morphTargetInfluences ? { morph: [...(node as Mesh).morphTargetInfluences!] } : {}) }));
}
function write(nodes: Map<string, Object3D>, data: PoseNode[]) {
    for (const entry of data) {
        const node = nodes.get(entry.path); if (!node) throw Error(`继承姿态节点已不存在：${entry.path}`);
        node.position.fromArray(entry.position); node.quaternion.fromArray(entry.quaternion); node.scale.fromArray(entry.scale); node.visible = entry.visible;
        if (entry.morph) {
            const morph = (node as Mesh).morphTargetInfluences; if (!morph || morph.length !== entry.morph.length) throw Error('继承姿态的形变目标已变化');
            entry.morph.forEach((v, i) => { morph[i] = v; });
        }
        node.matrixAutoUpdate = !entry.matrix;
        if (entry.matrix) node.matrix.fromArray(entry.matrix); else node.updateMatrix();
    }
}
export function captureInitialPose(root: Object3D, entity: Entity): InitialPose { return { version: 1, layout: poseLayout(entity), nodes: read(poseNodes(root)) }; }
/** Restore authored rest transforms before every sample, so reverse seeking never retains a frozen pose. */
export class InitialPoseRuntime {
    #entries = new Map<string, { root: Object3D; nodes: Map<string, Object3D>; rest: PoseNode[] }>();
    clear() { this.#entries.clear(); }
    remove(id: string) { this.#entries.delete(id); }
    register(e: Entity, root: Object3D) {
        if (!e.initialPose) return;
        const nodes = poseNodes(root), rest = read(nodes);
        if (e.initialPose.layout === poseLayout(e)) {
            if (e.initialPose.nodes.length !== nodes.size) throw Error('继承姿态与模型层级不匹配');
            write(nodes, e.initialPose.nodes); write(nodes, rest);
        }
        this.#entries.set(e.id, { root, nodes, rest });
    }
    restore(e: Entity) { const entry = this.#entries.get(e.id); if (entry) write(entry.nodes, entry.rest); }
    apply(e: Entity, time: number) {
        const entry = this.#entries.get(e.id); if (!entry || !inheritedPoseAt(e, time)) return false;
        write(entry.nodes, e.initialPose!.nodes); entry.root.updateWorldMatrix(true, true); return true;
    }
}
