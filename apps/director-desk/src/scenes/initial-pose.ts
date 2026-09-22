import type { Entity, Vec3 } from '../model.ts';

export interface PoseNode { path: string; position: Vec3; quaternion: [number, number, number, number]; scale: Vec3; visible: boolean; morph?: number[]; matrix?: number[] }
export interface InitialPose { version: 1; layout: string; nodes: PoseNode[] }
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)])) : value;
export const stableSceneJson = (value: unknown) => JSON.stringify(stable(value));
/** Only geometry/layout changes invalidate a captured local pose. Root placement and colour remain editable. */
export function poseLayout(e: Entity) {
    return stableSceneJson({ asset: e.asset, kind: e.kind, height: e.height, build: e.build, gender: e.gender,
        parameters: e.parameters, assetParameters: e.assetParameters, count: e.count, spacing: e.spacing, seed: e.seed,
        external: e.external && { ...e.external, appearance: undefined } });
}
export function inheritedPoseAt(e: Entity, time: number) { return !!e.initialPose && e.initialPose.layout === poseLayout(e) && !e.clips.some(c => c.start <= time); }
export function assertInitialPose(input: unknown) {
    if (input === undefined) return;
    const pose = input as InitialPose;
    const vector = (v: unknown, size: number) => Array.isArray(v) && v.length === size && v.every(x => typeof x === 'number' && Number.isFinite(x));
    if (!pose || typeof pose !== 'object' || Array.isArray(pose) || Object.keys(pose).some(k => !['version', 'layout', 'nodes'].includes(k))
        || pose.version !== 1 || typeof pose.layout !== 'string' || pose.layout.length > 1000000 || !Array.isArray(pose.nodes)) throw Error('继承姿态格式无效');
    const paths = new Set<string>();
    for (const node of pose.nodes) {
        if (!node || typeof node !== 'object' || Object.keys(node).some(k => !['path', 'position', 'quaternion', 'scale', 'visible', 'morph', 'matrix'].includes(k))
            || typeof node.path !== 'string' || !/^\d+(\/\d+)*$/.test(node.path) || paths.has(node.path)
            || !vector(node.position, 3) || !vector(node.scale, 3) || !vector(node.quaternion, 4)
            || Math.abs(Math.hypot(...node.quaternion) - 1) > 1e-5 || typeof node.visible !== 'boolean'
            || node.matrix !== undefined && !vector(node.matrix, 16)
            || node.morph !== undefined && (!Array.isArray(node.morph) || node.morph.some(v => typeof v !== 'number' || !Number.isFinite(v)))) throw Error('继承姿态节点无效');
        paths.add(node.path);
    }
}
