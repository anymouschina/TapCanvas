import * as T from 'three';
import type { Entity } from '../model.ts';
import type { LoadedModel, ModelInstance } from '../resources/model-runtime.ts';
import type { RetargetAnimation } from '../resources/retarget-animation.ts';
import { assertRigBindings } from '../resources/rig-definition.ts';
import { assertAnimationBinding } from '../resources/native-animation.ts';
import { ModelMotion } from '../resources/model-motion.ts';
import { HumanoidRetarget, type HumanoidSkeleton } from './humanoid-retarget.ts';
import { retargetClipTime } from './locomotion.ts';
import { FootGrounding, type FootGroundingState, type FootSurface } from './foot-grounding.ts';
import { transitionGroundingAt } from './transition-plan.ts';
import { footPlantPlans, footPlantSamplingEntity } from './foot-plant-plan.ts';
import { applyFootPlants, captureFootAnchor, measureFootPlants, type FootAnchor, type FootPlantState } from './foot-plant.ts';
import { builtinFootPlant } from './motion-catalog.ts';
import { measureStride } from './stride-measurement.ts';

type Source = { instance: ModelInstance; motion: ModelMotion; skeleton: HumanoidSkeleton; sampled: string; duration: number };
type Target = { skeleton: HumanoidSkeleton; referenceKey: string; bindings: Map<string, HumanoidRetarget>; grounding?: FootGrounding; contact?: FootGroundingState; plants?: FootPlantState[] };

/** Scene-owned animation evaluation. Sources may be sampled sequentially, targets never share mutable joints. */
export class RetargetRuntime {
    private load: (resourceId: string) => LoadedModel;
    private sources = new Map<string, Source>();
    private targets = new Map<string, Target>();
    constructor(load: (resourceId: string) => LoadedModel) { this.load = load; }
    private source(data: RetargetAnimation, key: string) {
        let source = this.sources.get(key);
        if (source) return source;
        const model = this.load(data.resourceId), info = model.inspection;
        assertRigBindings(data.rig, data.referencePose, info.bones); assertAnimationBinding(data, info.animations, info.nodes);
        const instance = model.instantiate(), motion = new ModelMotion(instance), frame = new T.Group(); frame.add(motion.root);
        try {
            instance.root.scale.setScalar(data.unitScale); instance.root.rotation.set(...data.orientation);
            const skeleton: HumanoidSkeleton = { frame, bones: instance.humanoidNodes(data.rig), resetReference() { motion.reset(); instance.setDefaultPose(data.referencePose); } };
            source = { instance, motion, skeleton, sampled: '', duration: info.animations.find(a => a.index === data.index)!.duration }; this.sources.set(key, source); return source;
        } catch (error) { instance.dispose(); throw error; }
    }
    private binding(target: Target, data: RetargetAnimation) {
        // Timeline clocks, foot correction and transition duration do not require another source mannequin.
        const key = JSON.stringify([data.resourceId, data.index, data.loop, data.unitScale, data.orientation, data.rig, data.referencePose, data.motion]), source = this.source(data, key);
        let transfer = target.bindings.get(key);
        if (!transfer) {
            transfer = new HumanoidRetarget(source.skeleton, target.skeleton); target.bindings.set(key, transfer);
            source.sampled = ''; // The constructor samples reference poses, invalidating any cached animated state.
        }
        return { source, transfer };
    }
    register(id: string, entity: Entity, skeleton: HumanoidSkeleton) {
        const target: Target = { skeleton, referenceKey: JSON.stringify(entity.external?.defaultPose ?? {}), bindings: new Map() };
        for (const clip of entity.clips) if (clip.retarget) this.binding(target, clip.retarget);
        if (entity.clips.some(c => c.retarget?.grounding)) target.grounding = new FootGrounding(skeleton);
        this.targets.set(id, target);
    }
    sample(id: string, entity: Entity, time: number, phase = 0) {
        const registered = this.targets.get(id); if (registered) { registered.contact = undefined; registered.plants = undefined; }
        const clip = entity.clips.find(c => c.action === 'retarget' && c.start <= time && time < c.end);
        if (!clip) {
            // Also reset geometry-free wrist/toe anchors. Procedural poses do not own those joints.
            this.targets.get(id)?.skeleton.resetReference(); return false;
        }
        const target = this.targets.get(id); if (!target) throw Error('适配动作的目标骨架尚未准备');
        const referenceKey = JSON.stringify(entity.external?.defaultPose ?? {});
        if (target.referenceKey !== referenceKey) { target.bindings.clear(); target.referenceKey = referenceKey; }
        const data = clip.retarget!, { source, transfer } = this.binding(target, data);
        // Fixed crowd phase only offsets looping clips; one-shot acting keeps its scheduled start and finish.
        const local = retargetClipTime(entity, clip, time, source.duration) + (data.loop ? phase : 0);
        const sampleKey = `${local}:${data.index}:${data.loop}`;
        if (source.sampled !== sampleKey) { source.motion.sample(data.index, local, data.loop, data.motion); source.sampled = sampleKey; }
        transfer.apply(); return true;
    }
    ground(id: string, entity: Entity, time: number, surface: FootSurface, samplePose?: (entity: Entity, time: number) => void, phase = 0) {
        const options = transitionGroundingAt(entity, time);
        const target = this.targets.get(id); if (!options || !target) return;
        target.grounding ??= new FootGrounding(target.skeleton);
        const clip = entity.clips.find(c => c.start <= time && time < c.end && c.retarget?.footPlant);
        const anchors: FootAnchor[] = [];
        if (clip && samplePose) {
            const { source } = this.binding(target, clip.retarget!);
            const plans = footPlantPlans(entity, clip, time, source.duration, phase);
            const samplingEntity = footPlantSamplingEntity(entity, clip);
            try { for (const plan of plans) { samplePose(samplingEntity, plan.anchorTime); anchors.push(captureFootAnchor(target.grounding, plan)); } }
            finally { if (plans.length) samplePose(entity, time); }
        }
        const plants = applyFootPlants(target.skeleton, anchors, clip?.retarget?.footPlant?.maxCorrection ?? 0, surface);
        target.contact = target.grounding.apply(options, surface);
        if (clip) target.plants = measureFootPlants(plants);
    }
    contactState(id: string) { return structuredClone(this.targets.get(id)?.contact ?? null); }
    plantState(id: string) { return structuredClone(this.targets.get(id)?.plants ?? null); }
    estimateStride(id: string, entity: Entity, clipId: string) {
        const target = this.targets.get(id), clip = entity.clips.find(c => c.id === clipId);
        if (!target || !clip?.retarget) throw Error('步幅校准需要已准备的人形适配动作');
        const profile = clip.retarget.footPlant ?? builtinFootPlant(clip);
        if (!profile) throw Error('此素材没有落脚区间，请先校准接触相位');
        const data = { ...clip.retarget, loop: true, motion: clip.retarget.motion ?? { mode: 'inPlace' as const, node: clip.retarget.rig.bones.hips! } };
        // Binding creation can temporarily reset the target, so it belongs inside the protected sampler.
        let binding: ReturnType<RetargetRuntime['binding']> | undefined;
        const duration = this.load(data.resourceId).inspection.animations.find(a => a.index === data.index)!.duration;
        try { return measureStride(target.skeleton, profile, duration, phase => {
            binding ??= this.binding(target, data);
            binding.source.motion.sample(data.index, phase * duration, true, data.motion); binding.transfer.apply();
        }); }
        finally { if (binding) binding.source.sampled = ''; }
    }
    remove(id: string) {
        this.targets.delete(id);
        const used = new Set([...this.targets.values()].flatMap(target => [...target.bindings.keys()]));
        for (const [key, source] of this.sources) if (!used.has(key)) { source.instance.dispose(); this.sources.delete(key); }
    }
    clear() { this.targets.clear(); for (const source of this.sources.values()) source.instance.dispose(); this.sources.clear(); }
}
