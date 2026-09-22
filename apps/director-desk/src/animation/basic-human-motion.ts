import { ACTIONS, entity, type Entity, type Action } from '../model.ts';
import { makeHuman } from '../assets/humanoid.ts';
import { sampleHumanAction } from '../assets/human-animation.ts';
import { disposeTree } from '../assets/dispose.ts';
import { sampledAction } from '../timeline.ts';
import { builtinHumanoidSkeleton } from './builtin-humanoid.ts';
import { HumanoidRetarget, type HumanoidSkeleton } from './humanoid-retarget.ts';

export const isBasicHumanAction = (action: string): action is Action => Object.hasOwn(ACTIONS, action) && action !== 'idle';
export const hasBasicHumanMotion = (e: Entity) => !!e.external && e.clips.some(c => isBasicHumanAction(c.action));

/** Reuse the existing coarse mannequin presets for compatible imported humans; no per-asset choreography. */
export class BasicHumanMotion {
    private rig = makeHuman(entity('actor', 'human-adult', 'Basic motion source'));
    private source = builtinHumanoidSkeleton(this.rig, entity('actor', 'human-adult', 'Basic motion source'));
    private targets = new Map<string, HumanoidRetarget>();
    register(id: string, skeleton: HumanoidSkeleton) { this.targets.set(id, new HumanoidRetarget(this.source, skeleton)); }
    sample(e: Entity, time: number) {
        const action = sampledAction(e, time).action;
        if (!isBasicHumanAction(action)) return false;
        const binding = this.targets.get(e.id); if (!binding) throw Error('基础动作的人形骨架尚未准备');
        this.source.resetReference(); sampleHumanAction(this.rig, e, time); binding.apply(); return true;
    }
    remove(id: string) { this.targets.delete(id); }
    dispose() { this.targets.clear(); disposeTree(this.rig.root); }
}
