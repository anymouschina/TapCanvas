import type { Project, Vec3 } from '../model.ts';
export interface SceneZone { id: string; name: string; color: string; min: Vec3; max: Vec3; connectsTo?: string[] }
export function assertZones(project: Project) {
    if (project.zones === undefined) return;
    if (!Array.isArray(project.zones) || project.zones.length > 256) throw Error('空间区域列表无效');
    const ids = new Set<string>();
    const vec = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
    for (const z of project.zones) {
        if (!z || typeof z.id !== 'string' || !/^[\p{L}\p{N}_:.-]{1,200}$/u.test(z.id) || ids.has(z.id)
            || typeof z.name !== 'string' || !z.name.trim() || z.name.length > 80 || typeof z.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(z.color)
            || !vec(z.min) || !vec(z.max) || z.min.some((v, i) => v >= z.max[i])) throw Error('区域标识、名称、颜色或范围无效');
        ids.add(z.id);
    }
    for (const z of project.zones) if (z.connectsTo !== undefined && (!Array.isArray(z.connectsTo) || new Set(z.connectsTo).size !== z.connectsTo.length
        || z.connectsTo.some(id => id === z.id || !ids.has(id)))) throw Error('区域连接引用不存在、重复或指向自身');
}
/** Membership uses current object origin; intersecting a room is not proof of being wholly inside it. */
export function zonesAt(project: Project, position: Vec3) {
    return (project.zones ?? []).filter(z => position.every((v, i) => v >= z.min[i] - 1e-7 && v <= z.max[i] + 1e-7)).map(z => z.id);
}
export function zoneConnections(project: Project, id: string) {
    return (project.zones ?? []).filter(z => z.id !== id && (z.connectsTo?.includes(id) || project.zones?.find(a => a.id === id)?.connectsTo?.includes(z.id))).map(z => z.id);
}
