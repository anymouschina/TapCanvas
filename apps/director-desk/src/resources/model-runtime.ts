import * as T from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { geometryBounds, boundsData } from '../spatial/geometry.ts';
import { assertRigBindings, suggestHumanoidRig, type HumanBone, type HumanoidRig, type ModelRestPose } from './rig-definition.ts';
import { nativeSourceTime, type ModelNodeDescriptor } from './native-animation.ts';
import { assertModelNodeBindings, type ModelNodeEdits } from './model-node-edits.ts';
import { ModelNodeRuntime } from './model-node-runtime.ts';
import { modelNodeHidden } from './model-node-visibility.ts';

export interface ModelSource { scene: T.Group; scenes: T.Group[]; cameras: T.Camera[]; animations: T.AnimationClip[]; materials?: T.Material[]; textures?: T.Texture[] }

export interface ModelInspection {
    bounds: ReturnType<typeof boundsData>;
    meshes: number; triangles: number; skins: number;
    bones: { path: string; name: string; parent: string | null; position: [number, number, number]; quaternion: [number, number, number, number] }[];
    nodes: ModelNodeDescriptor[];
    rigSuggestion: ReturnType<typeof suggestHumanoidRig>;
    animations: { index: number; name: string; duration: number; tracks: number }[];
    warnings: string[];
    copyright: string;
}
export interface LoadedModel {
    inspection: ModelInspection;
    instantiate(): ModelInstance;
    dispose(): void;
}
export interface ModelInstance {
    restoreNodeEdits(): void;
    applyNodeEdits(edits?: ModelNodeEdits): void;
    nodeState(path: string): { origin: [number, number, number]; hidden: boolean; offsetLimited: boolean; bounds: ReturnType<typeof boundsData> | null };
    root: T.Group;
    /** Native clip preview, independent of the director's path and future retargeted body actions. */
    sampleAnimation(index: number | null, time: number, loop?: boolean): void;
    setDefaultPose(pose?: ModelRestPose): void;
    /** Trusted renderer access to this instance's joints; never source/shared skeletons. */
    humanoidNodes(rig: HumanoidRig): Partial<Record<HumanBone, T.Bone>>;
    bonePosition(path: string): T.Vector3;
    /** Instance space excludes calibration on root; world space includes the actual scene hierarchy. */
    nodePosition(path: string, space?: 'world' | 'instance'): T.Vector3;
    setAppearance(mode: 'original' | 'white' | 'color', color?: string): void;
    dispose(): void;
}

/** Shared ownership, inspection and deterministic sampling for every import format. */
export function adoptModel(source: ModelSource, copyright: string, warnings: string[]): LoadedModel {
    let inspection: ModelInspection;
    try { inspection = inspect(source, copyright, warnings); }
    catch (error) { disposeSource(source); throw error; }
    const live = new Set<ModelInstance>(); let disposed = false;
    return {
        get inspection() { return structuredClone(inspection); },
        instantiate() {
            if (disposed) throw Error('模型资源已释放');
            const instance = createInstance(source, inspection.nodes, () => live.delete(instance)); live.add(instance); return instance;
        },
        dispose() { if (disposed) return; disposed = true; [...live].forEach(instance => instance.dispose()); disposeSource(source); }
    };
}

function inspect(source: ModelSource, copyright: string, initialWarnings: string[]): ModelInspection {
    const root = source.scene; root.updateMatrixWorld(true);
    let bounds = geometryBounds(root);
    const paths = new Map<T.Object3D, string>();
    const visit = (node: T.Object3D, path: string) => { paths.set(node, path); node.children.forEach((child, i) => visit(child, path + '/' + i)); }; visit(root, '0');
    const movingNodes = new Set<T.Object3D>();
    for (const animation of source.animations) for (const track of animation.tracks) {
        try {
            const parsed = T.PropertyBinding.parseTrackName(track.name);
            if (parsed.propertyName !== 'position') continue;
            const target = T.PropertyBinding.findNode(root, parsed.nodeName);
            if (target instanceof T.Object3D && !parsed.objectName) movingNodes.add(target);
        } catch { /* Unknown binding syntax remains available in the source animation; it is not a motion suggestion. */ }
    }
    const rigBranches = new Set<T.Object3D>(), geometries = new Map<T.BufferGeometry, number>();
    root.traverse(node => { if (node instanceof T.Bone || node instanceof T.SkinnedMesh) { for (let p: T.Object3D | null = node; p; p = p.parent) rigBranches.add(p); node.traverse(n => rigBranches.add(n)); } });
    const nodes: ModelNodeDescriptor[] = [...paths].map(([node, path]) => {
        if (node instanceof T.Mesh && !geometries.has(node.geometry)) geometries.set(node.geometry, geometries.size);
        const trs = new T.Matrix4().compose(node.position, node.quaternion, node.scale), representable = trs.elements.every((v, i) => Math.abs(v - node.matrix.elements[i]) <= 1e-8 * Math.max(1, Math.abs(v)));
        return { path, name: node.name, parent: node.parent ? paths.get(node.parent) ?? null : null, kind: node.type, positionAnimated: movingNodes.has(node),
            editable: representable && !rigBranches.has(node) && !(node instanceof T.Light || node instanceof T.Camera), ...(node instanceof T.Mesh ? { geometryId: geometries.get(node.geometry) } : {}) };
    });
    let meshes = 0, triangles = 0, skins = 0;
    const bones: ModelInspection['bones'] = [];
    root.traverse(node => {
        if (node instanceof T.Mesh) { meshes++; triangles += (node.geometry.index?.count ?? node.geometry.getAttribute('position')?.count ?? 0) / 3 * (node instanceof T.InstancedMesh ? node.count : 1); }
        if (node instanceof T.SkinnedMesh) skins++;
        if (node instanceof T.Bone) bones.push({ path: paths.get(node)!, name: node.name, parent: node.parent instanceof T.Bone ? paths.get(node.parent)! : null, position: node.getWorldPosition(new T.Vector3()).toArray(), quaternion: node.quaternion.toArray() });
    });
    if (!meshes) {
        if (!bones.length || !source.animations.some(a => Number.isFinite(a.duration) && a.duration > 0 && a.tracks.length))
            throw Error('文件需要可用网格，或带动画的骨架');
        bounds = new T.Box3().setFromPoints(bones.map(bone => new T.Vector3(...bone.position)));
    }
    if (!bounds || bounds.isEmpty() || ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite) || bounds.getSize(new T.Vector3()).length() < 1e-8) throw Error('模型或动作骨架没有可用的有限尺寸');
    const warnings = [...initialWarnings];
    if (!meshes) warnings.push('独立骨架动作资源；用于动作适配，不作为场景模型放置。');
    else if (!skins) warnings.push('未发现蒙皮骨架；可作为静态模型，不能直接使用人形动作。');
    else warnings.push('已保留蒙皮骨架；配置映射后仍需动作适配，不能仅凭骨骼存在判断动作兼容性。');
    if (source.scenes.length > 1) warnings.push('文件包含多个场景，当前使用其默认场景，原文件仍完整保留。');
    if (source.cameras.length) warnings.push('文件内摄影机仅保留在源资源中；导入实例使用导演台摄影机取景。');
    return { bounds: boundsData(bounds), meshes, triangles, skins, bones, nodes, copyright, rigSuggestion: suggestHumanoidRig(bones),
        animations: source.animations.map((clip, index) => ({ index, name: clip.name || `动画 ${index + 1}`, duration: clip.duration, tracks: clip.tracks.length })), warnings };
}

function createInstance(source: ModelSource, descriptors: readonly ModelNodeDescriptor[], onDispose: () => void): ModelInstance {
    const nodeEdits = new ModelNodeRuntime();
    let validatedEdits = '';
    const root = new T.Group(), content = cloneSkeleton(source.scene); root.add(content);
    const bones = new Map<string, T.Bone>(), nodes = new Map<string, T.Object3D>();
    const visit = (node: T.Object3D, path: string) => { nodes.set(path, node); if (node instanceof T.Bone) bones.set(path, node); node.children.forEach((child, i) => visit(child, path + '/' + i)); }; visit(content, '0');
    const boneDescriptors = [...bones].map(([path, node]) => ({ path, name: node.name, parent: null }));
    const originals = new Map<T.Mesh, T.Material | T.Material[]>(), materials = new Set<T.Material>();
    const rests: { node: T.Object3D; position: T.Vector3; quaternion: T.Quaternion; scale: T.Vector3; morph?: number[] }[] = [];
    content.traverse(node => {
        rests.push({ node, position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone(), morph: node instanceof T.Mesh ? node.morphTargetInfluences?.slice() : undefined });
        // Source cameras/lights are kept in the package, but do not control scene lighting or views.
        if (node instanceof T.Light || node instanceof T.Camera) node.visible = false;
        if (node instanceof T.Mesh) {
            const cloneMaterial = (material: T.Material) => { const copy = material.clone(); materials.add(copy); return copy; };
            node.material = Array.isArray(node.material) ? node.material.map(cloneMaterial) : cloneMaterial(node.material);
            originals.set(node, node.material); node.castShadow = true; node.receiveShadow = true;
        }
    });
    const override = new T.MeshStandardMaterial({ color: '#d9dcd7', roughness: .85 }); materials.add(override);
    const mixer = new T.AnimationMixer(content); let disposed = false, appearanceKey = '';
    const reset = () => {
        nodeEdits.restore();
        mixer.stopAllAction(); mixer.setTime(0);
        for (const rest of rests) {
            rest.node.position.copy(rest.position); rest.node.quaternion.copy(rest.quaternion); rest.node.scale.copy(rest.scale);
            // PropertyBinding retains the influences array. Keep its identity across arbitrary seeks.
            if (rest.morph && rest.node instanceof T.Mesh && rest.node.morphTargetInfluences) {
                const values = rest.node.morphTargetInfluences; rest.morph.forEach((value, index) => { values[index] = value; });
            }
        }
    };
    return {
        root,
        restoreNodeEdits() { nodeEdits.restore(); },
        applyNodeEdits(edits) { const key = JSON.stringify(edits ?? {}); if (key !== validatedEdits) { assertModelNodeBindings(edits, descriptors); validatedEdits = key; } nodeEdits.apply(root, nodes, edits); },
        nodeState(path) {
            const node = nodes.get(path); if (disposed || !node) throw Error('模型节点不存在或实例已释放');
            root.updateWorldMatrix(true, true); const bounds = geometryBounds(node);
            return { origin: node.getWorldPosition(new T.Vector3()).toArray(), hidden: modelNodeHidden(node), offsetLimited: nodeEdits.offsetLimited(node), bounds: bounds ? boundsData(bounds) : null };
        },
        humanoidNodes(rig) {
            if (disposed) throw Error('模型实例已释放');
            assertRigBindings(rig, undefined, boneDescriptors);
            return Object.fromEntries(Object.entries(rig.bones).map(([key, path]) => [key, bones.get(path)!]));
        },
        setDefaultPose(pose) {
            if (disposed) throw Error('模型实例已释放');
            assertRigBindings(undefined, pose, boneDescriptors); reset();
            for (const [path, angles] of Object.entries(pose ?? {})) bones.get(path)!.quaternion.multiply(new T.Quaternion().setFromEuler(new T.Euler(...angles, 'XYZ')));
            root.updateMatrixWorld(true);
        },
        bonePosition(path) {
            if (disposed || !bones.has(path)) throw Error('模型骨骼不存在或实例已释放');
            root.updateWorldMatrix(true, true); return bones.get(path)!.getWorldPosition(new T.Vector3());
        },
        nodePosition(path, space = 'world') {
            const node = nodes.get(path); if (disposed || !node) throw Error('模型节点不存在或实例已释放');
            if (space === 'world') { root.updateWorldMatrix(true, true); return node.getWorldPosition(new T.Vector3()); }
            // Compose local matrices without subtracting large world positions or depending on the last sampled scene transform.
            const matrix = new T.Matrix4();
            for (let current: T.Object3D | null = node; current && current !== root; current = current.parent) {
                if (current.matrixAutoUpdate) current.updateMatrix(); matrix.premultiply(current.matrix);
            }
            return new T.Vector3().setFromMatrixPosition(matrix);
        },
        sampleAnimation(index, time, loop = true) {
            if (disposed) throw Error('模型实例已释放');
            if (!Number.isFinite(time) || time < 0 || (index !== null && (!Number.isInteger(index) || !source.animations[index]))) throw Error('原生动画或采样时刻无效');
            const at = index === null ? 0 : nativeSourceTime(time, source.animations[index].duration, loop);
            reset();
            if (index !== null) {
                const action = mixer.clipAction(source.animations[index]);
                action.reset().setLoop(T.LoopOnce, 1); action.clampWhenFinished = true; action.play(); mixer.setTime(at);
            }
            root.updateMatrixWorld(true);
        },
        setAppearance(mode, color = '#d9dcd7') {
            if (disposed) throw Error('模型实例已释放');
            if (!['original', 'white', 'color'].includes(mode) || !/^#[0-9a-f]{6}$/i.test(color)) throw Error('模型显示方式或颜色无效');
            const key = mode + (mode === 'color' ? color.toLowerCase() : '');
            if (appearanceKey === key) return;
            override.color.set(mode === 'white' ? '#d9dcd7' : color);
            for (const [mesh, material] of originals) mesh.material = mode === 'original' ? material : override;
            appearanceKey = key;
        },
        dispose() {
            if (disposed) return; disposed = true; mixer.stopAllAction(); mixer.uncacheRoot(content);
            content.traverse(node => { if (node instanceof T.SkinnedMesh) node.skeleton.dispose(); if (node instanceof T.InstancedMesh) node.dispose(); });
            materials.forEach(material => material.dispose()); root.removeFromParent(); root.clear(); onDispose();
        }
    };
}

export function disposeSource(source: ModelSource) {
    const geometries = new Set<T.BufferGeometry>(), materials = new Set<T.Material>(), textures = new Set<T.Texture>(), skeletons = new Set<T.Skeleton>();
    source.materials?.forEach(material => materials.add(material));
    source.textures?.forEach(texture => textures.add(texture));
    for (const scene of source.scenes) scene.traverse(node => {
        if (node instanceof T.InstancedMesh) node.dispose();
        if (node instanceof T.Mesh || node instanceof T.Line || node instanceof T.Points) { geometries.add(node.geometry); (Array.isArray(node.material) ? node.material : [node.material]).forEach(m => materials.add(m)); }
        if (node instanceof T.SkinnedMesh) skeletons.add(node.skeleton);
    });
    for (const material of materials) for (const value of Object.values(material)) if (value instanceof T.Texture) textures.add(value);
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); skeletons.forEach(s => s.dispose());
    textures.forEach(texture => { texture.dispose(); const image = texture.source.data; if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) image.close(); });
}
