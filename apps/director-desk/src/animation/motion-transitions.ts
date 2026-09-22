import * as T from 'three';
import type { Entity } from '../model.ts';
import { motionTransitionAt, usesMaterialTransition, type MotionTransitionPlan } from './transition-plan.ts';

type Pose = { position: T.Vector3; rotation: T.Quaternion; scale: T.Vector3; morph?: number[] }[];
type Target = { frame: T.Object3D; nodes: T.Object3D[]; hips?: T.Object3D; state?: MotionTransitionPlan };
const snapshot = (nodes: T.Object3D[]): Pose => nodes.map(n => ({ position: n.position.clone(), rotation: n.quaternion.clone(), scale: n.scale.clone(),
    ...((n as T.Mesh).morphTargetInfluences ? { morph: [...(n as T.Mesh).morphTargetInfluences!] } : {}) }));

/** Blend instance-local transforms, leaving scene placement outside the pose. Never uses last rendered frame. */
export class MotionTransitions {
    private targets = new Map<string, Target>();
    register(id: string, frame: T.Object3D, hips?: T.Object3D) {
        const nodes: T.Object3D[] = []; frame.traverse(n => { if (n !== frame) nodes.push(n); });
        this.targets.set(id, { frame, nodes, hips });
    }
    sample(id: string, entity: Entity, time: number, raw: (time: number) => void) {
        const target = this.targets.get(id); if (!target) return false;
        const first = motionTransitionAt(entity, time); target.state = first ?? undefined;
        if (!first) {
            // Once a material-controlled handoff finishes, do not re-enter the legacy procedural crossfade.
            if (usesMaterialTransition(entity, time)) { raw(time); return true; }
            return false;
        }
        // Iterative evaluation supports short/trimmed chained clips without recursive stack growth.
        const stack: { pose: Pose; plan: MotionTransitionPlan }[] = [];
        let at = time, plan: MotionTransitionPlan | null = first;
        while (plan) {
            raw(at); stack.push({ pose: snapshot(target.nodes), plan });
            at = plan.fromTime; plan = motionTransitionAt(entity, at);
        }
        raw(at);
        for (const { pose, plan } of stack.reverse()) {
            const outgoing = entity.clips.find(c => c.id === plan.fromClipId);
            // Completed procedural turns already moved into the actor's scene yaw at this boundary.
            if (target.hips && outgoing?.action === 'turn' && Math.abs(outgoing.end - plan.start) < 1e-7)
                target.hips.quaternion.premultiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), -(outgoing.turnAmount ?? 1) * Math.PI));
            target.nodes.forEach((node, i) => {
            const p = pose[i];
            node.position.lerp(p.position, plan.weight); node.quaternion.slerp(p.rotation, plan.weight); node.scale.lerp(p.scale, plan.weight);
            const morph = (node as T.Mesh).morphTargetInfluences;
            if (morph && p.morph) for (let j = 0; j < morph.length; j++) morph[j] = T.MathUtils.lerp(morph[j], p.morph[j], plan.weight);
            node.updateMatrix();
            });
        }
        target.frame.updateWorldMatrix(true, true); target.frame.updateMatrixWorld(true); return true;
    }
    state(id: string) { return structuredClone(this.targets.get(id)?.state ?? null); }
    remove(id: string) { this.targets.delete(id); }
    clear() { this.targets.clear(); }
}
