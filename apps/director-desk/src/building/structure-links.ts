import { Euler, Quaternion, Vector3 } from 'three';
import type { Entity, Project, Vec3 } from '../model.ts';
import { structurePorts, type StructurePort } from './structure-ports.ts';

export interface StructureLink { parentId: string; parentPort: string; ownPort: string; offset: Vec3; rotation: Vec3 }
const vector = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number' && Number.isFinite(n));
export const staticStructure = (e: Entity) => e.kind === 'prop' && !e.path && !e.handBinding && !e.clips.length && structurePorts(e).length > 0;
const quaternion = (r: Vec3) => new Quaternion().setFromEuler(new Euler(...r));
const scaledYaw = (port: StructurePort, e: Entity) => Math.atan2(Math.sin(port.yaw) * e.scale[0], Math.cos(port.yaw) * e.scale[2]);
function frame(e: Entity, parent: Entity) {
    const link = e.structureLink!, from = structurePorts(parent).find(p => p.id === link.parentPort)!, to = structurePorts(e).find(p => p.id === link.ownPort)!;
    const parentRotation = quaternion(parent.rotation);
    const rotation = parentRotation.clone().multiply(quaternion([0, scaledYaw(from, parent) + Math.PI - scaledYaw(to, e), 0]));
    const position = new Vector3(...from.position).multiply(new Vector3(...parent.scale)).applyQuaternion(parentRotation).add(new Vector3(...parent.position));
    return { parentRotation, rotation, position, to };
}
function expected(e: Entity, parent: Entity) {
    const f = frame(e, parent), link = e.structureLink!, q = f.rotation.multiply(quaternion(link.rotation));
    const position = f.position.add(new Vector3(...link.offset).applyQuaternion(f.parentRotation))
        .sub(new Vector3(...f.to.position).multiply(new Vector3(...e.scale)).applyQuaternion(q));
    const r = new Euler().setFromQuaternion(q);
    return { position: position.toArray() as Vec3, rotation: [r.x, r.y, r.z] as Vec3 };
}
/** Iterative topological order: each child has one parent; cycles and dangling references fail. */
function ordered(project: Project) {
    const entities = new Map(project.entities.map(e => [e.id, e])), links = project.entities.filter(e => e.structureLink != null);
    const children = new Map<string, Entity[]>(), indegree = new Map<string, number>();
    for (const e of links) {
        const b = e.structureLink!;
        if (!b || typeof b !== 'object' || Array.isArray(b) || typeof b.parentId !== 'string' || !vector(b.offset) || !vector(b.rotation)) throw Error('模块连接数据无效');
        const parent = entities.get(b.parentId);
        if (!parent || parent === e) throw Error('连接目标不存在或指向自身');
        if (!staticStructure(e) || !staticStructure(parent)) throw Error('连接仅用于具有接口的静态建筑模块；请先解除路径、手持或动画');
        if (!structurePorts(parent).some(p => p.id === b.parentPort) || !structurePorts(e).some(p => p.id === b.ownPort)) throw Error('模块连接接口不存在，请重新选择接口');
        if (!children.has(parent.id)) children.set(parent.id, []);
        children.get(parent.id)!.push(e); indegree.set(e.id, parent.structureLink ? 1 : 0);
    }
    const queue = links.filter(e => indegree.get(e.id) === 0);
    for (let i = 0; i < queue.length; i++) for (const child of children.get(queue[i].id) ?? []) { indegree.set(child.id, 0); queue.push(child); }
    if (queue.length !== links.length) throw Error('模块连接形成循环，请解除其中一条连接');
    return { queue, entities };
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** Keep user-edited world transforms by converting them to link offsets, before propagation. */
export function captureStructureEdits(project: Project): Pick<Project, 'entities'> {
    return { entities: project.entities.filter(e => e.structureLink).map(e => ({ ...e, position: [...e.position], rotation: [...e.rotation], structureLink: structuredClone(e.structureLink) })) };
}
export function syncStructureLinks(project: Project, before?: Pick<Project, 'entities'>) {
    const { queue, entities } = ordered(project), old = new Map(before?.entities.map(e => [e.id, e]));
    for (const e of queue) {
        const parent = entities.get(e.structureLink!.parentId)!, previous = old.get(e.id);
        if (previous && same(previous.structureLink, e.structureLink) && (!same(previous.position, e.position) || !same(previous.rotation, e.rotation))) {
            const f = frame(e, parent), q = quaternion(e.rotation);
            e.structureLink!.rotation = new Euler().setFromQuaternion(f.rotation.invert().multiply(q)).toArray().slice(0, 3) as Vec3;
            e.structureLink!.offset = new Vector3(...e.position).add(new Vector3(...f.to.position).multiply(new Vector3(...e.scale)).applyQuaternion(q))
                .sub(f.position).applyQuaternion(f.parentRotation.invert()).toArray() as Vec3;
        }
        const next = expected(e, parent);
        // Preserve exact values when equivalent: repeated reads/commits do not create tiny edits to locked objects.
        if (new Vector3(...e.position).distanceTo(new Vector3(...next.position)) > 1e-9) e.position = next.position;
        if (1 - Math.abs(quaternion(e.rotation).dot(quaternion(next.rotation))) > 1e-14) e.rotation = next.rotation;
    }
}
export function assertStructureLinks(project: Project) {
    const { queue, entities } = ordered(project);
    for (const e of queue) {
        const next = expected(e, entities.get(e.structureLink!.parentId)!);
        if (new Vector3(...e.position).distanceTo(new Vector3(...next.position)) > 1e-7 || 1 - Math.abs(quaternion(e.rotation).dot(quaternion(next.rotation))) > 1e-12)
            throw Error('模块连接位置尚未更新，请使用共用连接更新后保存');
    }
}
export function disconnectStructure(e: Entity) { if (e.locked) throw Error('连接模块已锁定，请先解锁'); e.structureLink = null; }
