import type { Mesh, Object3D } from 'three';
import type { Entity } from '../model.ts';
import { makeActor } from '../assets/actors.ts';
import { makeCrowd } from '../assets/crowd.ts';
import { disposeTree, makeProp } from '../assets.ts';
import { poseLayout } from './initial-pose.ts';
import { poseNodes } from './initial-pose-runtime.ts';

const layouts = new Map<string, Map<string, number>>();
/** Validate persisted node paths before a document transaction reaches the live renderer. */
export function assertInitialPoseBindings(e: Entity, external: () => { root: Object3D; dispose(): void }) {
    if (!e.initialPose || e.initialPose.layout !== poseLayout(e)) return;
    const key = e.initialPose.layout;
    let nodes = layouts.get(key);
    if (!nodes) {
        const instance = e.external ? external() : (() => { const root = e.kind === 'actor' ? makeActor(e).root : e.kind === 'crowd' ? makeCrowd(e).root : makeProp(e); return { root, dispose: () => disposeTree(root) }; })();
        try {
            nodes = new Map([...poseNodes(instance.root)].map(([path, node]) => [path, (node as Mesh).morphTargetInfluences?.length ?? -1]));
            layouts.set(key, nodes); if (layouts.size > 32) layouts.delete(layouts.keys().next().value!);
        } finally { instance.dispose(); }
    }
    if (e.initialPose.nodes.length !== nodes.size || e.initialPose.nodes.some(n => !nodes!.has(n.path) || n.morph !== undefined && n.morph.length !== nodes!.get(n.path))) throw Error('继承姿态与模型节点层级不匹配');
}
