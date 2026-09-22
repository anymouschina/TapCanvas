import * as T from 'three';
import { assertInitialPoseBindings } from '../scenes/pose-binding-validation.ts';
import type { Entity, Project } from '../model.ts';
import { geometryBounds } from '../spatial/geometry.ts';
import { modelResourceId, type ModelResource } from './project-resources.ts';
import type { LoadedModel, ModelInstance } from './model-runtime.ts';
import { assertRigBindings } from './rig-definition.ts';
import { assertNativeBindings, nativeSample } from './native-animation.ts';
import { ModelMotion } from './model-motion.ts';
import { RetargetRuntime } from '../animation/retarget-runtime.ts';
import { retargetSetupKey, validateRetargetSetup } from '../animation/retarget-validation.ts';
import { builtinHumanoidSkeleton } from '../animation/builtin-humanoid.ts';
import type { Rig } from '../assets/human-legacy.ts';
import type { FootSurface } from '../animation/foot-grounding.ts';
import { MotionTransitions } from '../animation/motion-transitions.ts';
import { sampleHumanAction, sampleHumanBody } from '../assets/human-animation.ts';
import { usesMaterialTransition } from '../animation/transition-plan.ts';
import { BasicHumanMotion, hasBasicHumanMotion } from '../animation/basic-human-motion.ts';
import { assertModelNodeBindings } from './model-node-edits.ts';
import { sameModelPackage } from './package-validation.ts';
import type { ModelPackage } from './model-package.ts';

/** Prepared sources survive synchronous scene rebuilds and undo; instances never share mutable bones/materials. */
export class SceneModels {
    private sources = new Map<string, { model: LoadedModel; package: ModelPackage }>();
    private instances = new Map<string, { instance: ModelInstance; motion: ModelMotion; root: T.Group; sourceHeight: number; poseKey: string }>();
    private preparation = Promise.resolve();
    private retargets = new RetargetRuntime(id => this.loaded(id));
    private transitions = new MotionTransitions();
    private humanRigs = new Map<string, Rig>();
    private basics?: BasicHumanMotion;
    private validRetargets = new Set<string>();
    private loaded(id: string) { const source = this.sources.get(id); if (!source) throw Error('动作模型资源尚未加载'); return source.model; }
    private validateRetargets(project: Project, load: (id: string) => LoadedModel, cache = false) {
        for (const entity of project.entities) if (entity.clips.some(c => c.retarget) || hasBasicHumanMotion(entity)) {
            const key = retargetSetupKey(entity); if (cache && this.validRetargets.has(key)) continue;
            validateRetargetSetup(entity, load); if (cache) this.validRetargets.add(key);
        }
    }
    prepare(project: Project, signal?: AbortSignal) {
        const task = this.preparation.then(() => this.prepareSources(project, signal));
        this.preparation = task.catch(() => {}); return task;
    }
    private async prepareSources(project: Project, signal?: AbortSignal) {
        const staged = new Map<string, { model: LoadedModel; package: ModelPackage }>();
        try {
            for (const resource of project.resources ?? []) {
                signal?.throwIfAborted(); const old = this.sources.get(resource.id);
                if (old && sameModelPackage(old.package, resource.package)) continue;
                if (old) throw Error('相同模型资源 ID 对应了不同内容');
                if (await modelResourceId(resource.package) !== resource.id) throw Error('模型资源内容与标识不匹配');
                const { loadModelPackage } = await import('./model-loader.ts');
                const model = await loadModelPackage(resource.package, signal); staged.set(resource.id, { model, package: structuredClone(resource.package) });
            }
            signal?.throwIfAborted();
            for (const entity of project.entities) if (entity.external) {
                const source = staged.get(entity.external.resourceId) ?? this.sources.get(entity.external.resourceId);
                if (source) {
                    const info = source.model.inspection;
                    if (!info.meshes) throw Error('独立动作资源不能作为场景模型放置，请应用到已有的人物');
                    assertRigBindings(entity.external.rig, entity.external.defaultPose, info.bones);
                    assertNativeBindings(entity, info.animations, info.nodes);
                    assertModelNodeBindings(entity.external.nodeEdits, info.nodes);
                }
            }
            this.validateRetargets(project, id => {
                const source = staged.get(id) ?? this.sources.get(id); if (!source) throw Error('适配动作资源不存在'); return source.model;
            });
            staged.forEach((value, id) => this.sources.set(id, value));
        } catch (error) { staged.forEach(value => value.model.dispose()); throw error; }
    }
    assertReady(project: Project) {
        for (const resource of project.resources ?? []) { const source = this.sources.get(resource.id); if (!source || !sameModelPackage(source.package, resource.package)) throw Error('请先完成工程模型资源加载'); }
        for (const entity of project.entities) if (entity.external) {
            const info = this.sources.get(entity.external.resourceId)!.model.inspection;
            if (!info.meshes) throw Error('独立动作资源不能作为场景模型放置，请应用到已有的人物');
            assertRigBindings(entity.external.rig, entity.external.defaultPose, info.bones);
            assertNativeBindings(entity, info.animations, info.nodes);
            assertModelNodeBindings(entity.external.nodeEdits, info.nodes);
        }
        this.validateRetargets(project, id => this.loaded(id), true);
        for (const entity of project.entities) assertInitialPoseBindings(entity, () => {
            const instance = this.loaded(entity.external!.resourceId).instantiate(), root = new T.Group();
            root.add(new ModelMotion(instance).root);
            return { root, dispose: () => instance.dispose() };
        });
    }
    inspection(resource: ModelResource) { const source = this.sources.get(resource.id); if (!source) throw Error('模型尚未加载'); return source.model.inspection; }
    nodes(project: Project, entityId: string, options: { path?: string; query?: string; offset?: number; limit?: number } = {}) {
        const e = project.entities.find(e => e.id === entityId); if (!e?.external) throw Error('请选择导入模型实例');
        const info = this.loaded(e.external.resourceId).inspection, edits = e.external.nodeEdits ?? {}, instance = this.instances.get(e.id)?.instance;
        if (!instance) throw Error('模型实例尚未准备');
        const offset = options.offset ?? 0, limit = options.limit ?? 30;
        if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw Error('节点分页参数无效');
        if (options.path !== undefined && !info.nodes.some(n => n.path === options.path)) throw Error('源模型节点不存在');
        const query = (options.query ?? '').trim().toLocaleLowerCase();
        const matching = info.nodes.filter(n => (options.path === undefined || n.path === options.path || n.parent === options.path)
            && (!query || [n.path, n.name, edits[n.path]?.name, edits[n.path]?.category].filter(Boolean).join(' ').toLocaleLowerCase().includes(query)));
        return { entityId, resourceId: e.external.resourceId, total: matching.length, offset, nextOffset: offset + limit < matching.length ? offset + limit : null,
            nodes: matching.slice(offset, offset + limit).map(n => ({ ...n, displayName: edits[n.path]?.name ?? n.name, category: edits[n.path]?.category ?? '', edit: structuredClone(edits[n.path] ?? {}), ...instance.nodeState(n.path) })),
            coordinates: 'origin/bounds 为当前帧世界米；offset 为模型坐标米（对象缩放前），rotation 为节点自身 XYZ 弧度，scale 为源节点倍率。名称和分类不改变源节点路径。' };
    }
    bonePosition(entityId: string, path: string) { const entry = this.instances.get(entityId); if (!entry) throw Error('模型实例不存在'); return entry.instance.bonePosition(path); }
    handFrame(actor: Entity, hand: 'left' | 'right') {
        const entry = this.instances.get(actor.id), bone = entry?.instance.humanoidNodes(actor.external!.rig!)[`${hand}Hand`];
        if (!bone) throw Error('手部骨架尚未准备');
        bone.updateWorldMatrix(true, false);
        return { position: bone.getWorldPosition(new T.Vector3()), rotation: bone.getWorldQuaternion(new T.Quaternion()).normalize() };
    }
    motionState(entityId: string) { return this.instances.get(entityId)?.motion.state() ?? null; }
    measure(resource: ModelResource, unitScale: number, orientation: [number, number, number]) {
        const source = this.sources.get(resource.id); if (!source) throw Error('模型尚未加载');
        const instance = source.model.instantiate();
        try { instance.root.scale.setScalar(unitScale); instance.root.rotation.set(...orientation); return geometryBounds(instance.root)!.getSize(new T.Vector3()).toArray(); }
        finally { instance.dispose(); }
    }
    registerHuman(entity: Entity, rig: Rig, id = entity.id) {
        if (entity.clips.some(c => c.retarget)) {
            this.retargets.register(id, entity, builtinHumanoidSkeleton(rig, entity));
            this.humanRigs.set(id, rig); this.transitions.register(id, rig.root, rig.hips);
        }
    }
    sampleHuman(entity: Entity, time: number, id = entity.id, phase = 0) {
        if (this.transitions.sample(id, entity, time, at => {
            if (!this.retargets.sample(id, entity, at, phase)) {
                const sample = usesMaterialTransition(entity, at) ? sampleHumanAction : sampleHumanBody;
                sample(this.humanRigs.get(id)!, entity, at, phase);
            }
        })) return true;
        return this.retargets.sample(id, entity, time, phase);
    }
    groundHuman(entity: Entity, time: number, surface: FootSurface, id = entity.id, samplePose?: (entity: Entity, time: number) => void, phase = 0) { this.retargets.ground(id, entity, time, surface, samplePose, phase); }
    humanContactState(id: string) { return this.retargets.contactState(id); }
    humanPlantState(id: string) { return this.retargets.plantState(id); }
    estimateStride(entity: Entity, clipId: string) {
        if (entity.kind !== 'crowd') return this.retargets.estimateStride(entity.id, entity, clipId);
        const members = Array.from({ length: entity.count }, (_, index) => ({ index, rig: this.humanRigs.get(`${entity.id}:${index}`) }))
            .filter(member => member.rig).map(({ index, rig }) => ({ index, scale: rig!.root.getWorldScale(new T.Vector3()).z })).sort((a, b) => a.scale - b.scale);
        if (!members.length) throw Error('群演人形骨架尚未准备');
        const sampleMember = members[Math.floor(members.length / 2)].index;
        return { ...this.retargets.estimateStride(`${entity.id}:${sampleMember}`, entity, clipId), crowd: { sampleMember, count: members.length } };
    }
    motionTransitionState(id: string) { return this.transitions.state(id); }
    removeInstance(id: string, crowdIds: string[] = []) {
        for (const key of [id, ...crowdIds]) { this.retargets.remove(key); this.transitions.remove(key); this.humanRigs.delete(key); this.basics?.remove(key); }
        const entry = this.instances.get(id);
        if (entry) { entry.instance.dispose(); entry.root.removeFromParent(); entry.root.clear(); this.instances.delete(id); }
        return !!entry;
    }
    clearInstances() { this.retargets.clear(); this.transitions.clear(); this.humanRigs.clear(); this.basics?.dispose(); this.basics = undefined; this.instances.forEach(({ instance, root }) => { instance.dispose(); root.removeFromParent(); root.clear(); }); this.instances.clear(); }
    create(entity: Entity): T.Group {
        const data = entity.external!, source = this.sources.get(data.resourceId); if (!source) throw Error('模型尚未加载');
        const instance = source.model.instantiate(), motion = new ModelMotion(instance), root = new T.Group(); root.add(motion.root);
        instance.root.rotation.set(...data.orientation); instance.root.scale.setScalar(data.unitScale); root.updateMatrixWorld(true);
        const bounds = geometryBounds(root)!;
        const height = bounds.max.y - bounds.min.y;
        if (entity.kind === 'actor' && height < 1e-6) { instance.dispose(); throw Error('人物模型校正后的高度为零'); }
        instance.root.position.set(-(bounds.min.x + bounds.max.x) / 2, -bounds.min.y, -(bounds.min.z + bounds.max.z) / 2);
        instance.setDefaultPose(data.defaultPose);
        this.instances.set(entity.id, { instance, motion, root, sourceHeight: height, poseKey: JSON.stringify(data.defaultPose ?? {}) });
        if (entity.clips.some(c => c.retarget) || hasBasicHumanMotion(entity)) {
            const skeleton = { frame: root, bones: instance.humanoidNodes(data.rig!), resetReference: () => { motion.reset(); instance.setDefaultPose(entity.external!.defaultPose); } };
            if (entity.clips.some(c => c.retarget)) this.retargets.register(entity.id, entity, skeleton);
            if (hasBasicHumanMotion(entity)) { this.basics ??= new BasicHumanMotion(); this.basics.register(entity.id, skeleton); }
            this.transitions.register(entity.id, root, skeleton.bones.hips);
        }
        return root;
    }
    sample(entity: Entity, monochrome: boolean, time = 0) {
        const entry = this.instances.get(entity.id); if (!entry) throw Error('模型实例不存在');
        entry.instance.restoreNodeEdits();
        const factor = entity.kind === 'actor' ? entity.height / entry.sourceHeight : 1;
        entry.root.scale.set(...entity.scale.map(value => value * factor) as [number, number, number]);
        const poseKey = JSON.stringify(entity.external!.defaultPose ?? {});
        const raw = (at: number) => {
            const animation = nativeSample(entity, at);
            if (this.retargets.sample(entity.id, entity, at)) { entry.poseKey = ''; }
            else if (animation) { entry.motion.sample(animation.index, animation.time, animation.loop, animation.motion); entry.poseKey = ''; }
            else if (this.basics?.sample(entity, at)) { entry.poseKey = ''; }
            else if (poseKey !== entry.poseKey) { entry.motion.reset(); entry.instance.setDefaultPose(entity.external!.defaultPose); entry.poseKey = poseKey; }
        };
        if (this.transitions.sample(entity.id, entity, time, raw)) entry.poseKey = '';
        else raw(time);
        entry.instance.applyNodeEdits(entity.external!.nodeEdits);
        entry.instance.setAppearance(monochrome ? 'white' : entity.external!.appearance, entity.color);
    }
    /** History owns which immutable sources must remain available for synchronous undo. */
    retain(projects: readonly { resources?: readonly { id: string }[] }[]) {
        const keep = new Set(projects.flatMap(project => (project.resources ?? []).map(r => r.id)));
        for (const [id, entry] of this.sources) if (!keep.has(id)) { entry.model.dispose(); this.sources.delete(id); }
    }
    dispose() { this.clearInstances(); this.sources.forEach(entry => entry.model.dispose()); this.sources.clear(); this.validRetargets.clear(); }
}
