import * as T from 'three';
import type { ModelInstance } from './model-runtime.ts';
import type { NativeMotion } from './native-animation.ts';

/** Cancels source horizontal translation after unit/up-axis calibration, before entity placement.
 * Reference is source frame zero, including after split/trim or loop. This is not foot IK or yaw extraction.
 */
export class ModelMotion {
    readonly root = new T.Group();
    private references = new Map<string, T.Vector3>();
    private node: string | null = null;
    private instance: ModelInstance;
    constructor(instance: ModelInstance) { this.instance = instance; this.root.add(instance.root); }
    private calibratedPosition(path: string) {
        const root = this.instance.root; if (root.matrixAutoUpdate) root.updateMatrix();
        return this.instance.nodePosition(path, 'instance').applyMatrix4(root.matrix);
    }
    reset() { this.root.position.set(0, 0, 0); this.node = null; }
    sample(index: number, time: number, loop: boolean, motion?: NativeMotion) {
        this.reset();
        if (!motion) { this.instance.sampleAnimation(index, time, loop); return; }
        const key = `${index}:${motion.node}`;
        let reference = this.references.get(key);
        if (!reference) {
            // Preserve source coordinates in the cache, so later unit/orientation calibration cannot stale it.
            this.instance.sampleAnimation(index, 0, false); reference = this.instance.nodePosition(motion.node, 'instance'); this.references.set(key, reference);
        }
        this.instance.sampleAnimation(index, time, loop);
        const current = this.calibratedPosition(motion.node), origin = reference.clone().applyMatrix4(this.instance.root.matrix);
        this.root.position.set(origin.x - current.x, 0, origin.z - current.z); this.node = motion.node;
        this.root.updateWorldMatrix(true, true);
    }
    state() {
        if (!this.node) return null;
        this.root.updateWorldMatrix(true, true);
        const basis = new T.Matrix3().setFromMatrix4(this.root.parent?.matrixWorld ?? new T.Matrix4());
        return { node: this.node, anchorWorld: this.instance.nodePosition(this.node).toArray(), removedWorld: this.root.position.clone().negate().applyMatrix3(basis).toArray() };
    }
}
