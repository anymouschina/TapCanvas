import type { Entity } from '../model.ts';

/** These values are consumed by sampling, helpers or labels, not by model construction.
 * Keep geometry, initial poses and animation registration data in the key. */
export function modelConstructionKey(entity: Entity) {
    const { surface, deform, warp, name, locked, reference, position, rotation, visible, floorId, structureLink,
        contactAnchors, handBinding, path, face, faceTarget, pose, poseKeys, camera,
        actionBlend, footContact, ...construction } = entity;
    const runtimeColor = entity.kind === 'actor' || entity.kind === 'crowd' || !!entity.external;
    // Retarget reference skeletons depend on scale. Static props and cameras do not.
    return JSON.stringify({ ...construction, visual:entity.visual&&{preset:entity.visual.preset,count:entity.visual.count,seed:entity.visual.seed,text:entity.visual.text,secondaryColor:entity.visual.secondaryColor,...(['mirror','portal'].includes(entity.visual.preset)?{quality:entity.visual.quality}:{}),additive:entity.visual.additive}, field:entity.field&&{type:entity.field.type},warp:entity.warp&&{type:entity.warp.type}, ...(runtimeColor ? {color:undefined} : {}),
        ...(!entity.external && entity.kind !== 'actor' && entity.kind !== 'crowd' ? {scale:undefined} : {}),
        external: entity.external && {...entity.external, appearance:undefined} });
}

/** Retain only live instances. Capture values, since editor entities may be mutated in place. */
export class SceneRenderCache {
    private keys = new Map<string, string>();
    invalidate() { this.keys.clear(); }
    reconcile(entities: Entity[], liveIds: Iterable<string>) {
        const next = new Map(entities.map(entity => [entity.id, modelConstructionKey(entity)]));
        const live = new Set(liveIds);
        const removed = [...live].filter(id => !next.has(id) || this.keys.get(id) !== next.get(id));
        const added = entities.filter(entity => !live.has(entity.id) || this.keys.get(entity.id) !== next.get(entity.id));
        return { removed, added, commit: () => { this.keys = next; } };
    }
}
