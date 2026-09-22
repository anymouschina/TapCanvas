import * as T from 'three';
import type { Entity } from '../model.ts';
import { makeHuman, scaleLegacyHuman, type Rig } from './human-legacy.ts';

/** Geometry ownership belongs to the entire returned crowd root. Dispose the group once.
 * Members keep separate transforms, joints and materials; queries still see their real meshes. */
export function makeCrowd(entity: Entity) {
    const root = new T.Group(), rigs: Rig[] = [];
    const random = (seed: number) => { const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
    const template = makeHuman(entity), columns = Math.ceil(Math.sqrt(entity.count));
    for (let i = 0; i < entity.count; i++) {
        const rig = i ? cloneMember(template) : template;
        scaleLegacyHuman(rig.root, { height: entity.height * (.94 + random(entity.seed + i) * .12), build: entity.build });
        rig.root.position.set((i % columns - (columns - 1) / 2) * entity.spacing, 0, (Math.floor(i / columns) - (Math.ceil(entity.count / columns) - 1) / 2) * entity.spacing);
        rig.root.rotation.y = (random(entity.seed + i + 100) - .5) * .4;
        rig.root.traverse(o => { if (o instanceof T.Mesh) o.castShadow = entity.count <= 40; });
        root.add(rig.root); rigs.push(rig);
    }
    return { root, rigs };
}

function cloneMember(source: Rig): Rig {
    const root = source.root.clone(true), originals: T.Object3D[] = [], copies: T.Object3D[] = [];
    source.root.traverse(o => originals.push(o)); root.traverse(o => copies.push(o));
    const nodes = new Map(originals.map((o, i) => [o, copies[i]]));
    const materials = new Map<T.Material, T.Material>();
    const material = (source: T.Material) => {
        if (!materials.has(source)) materials.set(source, source.clone());
        return materials.get(source)!;
    };
    root.traverse(o => { if (o instanceof T.Mesh) o.material = Array.isArray(o.material) ? o.material.map(material) : material(o.material); });
    return { root, hips: nodes.get(source.hips) as T.Group, head: nodes.get(source.head) as T.Group,
        joints: Object.fromEntries(Object.entries(source.joints).map(([name, node]) => [name, nodes.get(node) as T.Group])),
        skin: material(source.skin) as T.MeshStandardMaterial,
        jointSkin: source.jointSkin ? material(source.jointSkin) as T.MeshStandardMaterial : undefined };
}
