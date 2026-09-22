import * as T from 'three';
import type { Entity } from '../model.ts';
import type { LoadedModel } from '../resources/model-runtime.ts';
import { makeHuman } from '../assets/humanoid.ts';
import { disposeTree } from '../assets/dispose.ts';
import { builtinHumanoidSkeleton } from './builtin-humanoid.ts';
import { RetargetRuntime } from './retarget-runtime.ts';
import { BasicHumanMotion, hasBasicHumanMotion } from './basic-human-motion.ts';

/** Preflight on disposable instances before committing a file/tool/UI transaction. */
export function validateRetargetSetup(entity: Entity, load: (id: string) => LoadedModel) {
    const runtime = new RetargetRuntime(load);
    let basics: BasicHumanMotion | undefined;
    let disposeTarget = () => {};
    try {
        if (entity.external) {
            const data = entity.external, instance = load(data.resourceId).instantiate(); disposeTarget = () => instance.dispose();
            const frame = new T.Group(); frame.add(instance.root); instance.root.rotation.set(...data.orientation); instance.root.scale.setScalar(data.unitScale);
            const skeleton = { frame, bones: instance.humanoidNodes(data.rig!), resetReference: () => instance.setDefaultPose(data.defaultPose) };
            if (entity.clips.some(c => c.retarget)) runtime.register(entity.id, entity, skeleton);
            if (hasBasicHumanMotion(entity)) { basics = new BasicHumanMotion(); basics.register(entity.id, skeleton); }
        } else {
            const rig = makeHuman(entity); disposeTarget = () => disposeTree(rig.root);
            runtime.register(entity.id, entity, builtinHumanoidSkeleton(rig, entity));
        }
    } finally { runtime.clear(); basics?.dispose(); disposeTarget(); }
}
export function retargetSetupKey(e: Entity) {
    return JSON.stringify([e.kind, e.asset, e.height, e.build, e.gender, e.assetParameters, e.external, hasBasicHumanMotion(e), e.clips.filter(c => c.retarget).map(c => c.retarget)]);
}
