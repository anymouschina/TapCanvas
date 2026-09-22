import * as T from 'three';
import type { ModelNodeEdits } from './model-node-edits.ts';
import { setModelNodeHidden } from './model-node-visibility.ts';

/** Non-destructive post-animation overrides. Restore the sampled base before the next seek. */
export class ModelNodeRuntime {
    private limited = new WeakSet<T.Object3D>();
    offsetLimited(node: T.Object3D) { return this.limited.has(node); }
    private saved = new Map<T.Object3D, { position: T.Vector3; rotation: T.Quaternion; scale: T.Vector3; visible: boolean }>();
    restore() {
        for (const [node, state] of this.saved) { node.position.copy(state.position); node.quaternion.copy(state.rotation); node.scale.copy(state.scale); node.visible = state.visible; node.updateMatrix(); setModelNodeHidden(node, false); }
        this.saved.clear(); this.limited = new WeakSet();
    }
    apply(root: T.Object3D, nodes: ReadonlyMap<string, T.Object3D>, edits?: ModelNodeEdits) {
        this.restore();
        const entries = Object.entries(edits ?? {}).sort(([a], [b]) => a.split('/').length - b.split('/').length);
        for (const [path, edit] of entries) {
            if (!edit.offset && !edit.rotation && !edit.scale && edit.hidden === undefined) continue;
            const node = nodes.get(path); if (!node) throw Error('模型节点不存在：' + path);
            this.saved.set(node, { position: node.position.clone(), rotation: node.quaternion.clone(), scale: node.scale.clone(), visible: node.visible });
            if (edit.offset) {
                const frame = root.parent; frame?.updateWorldMatrix(true, false); node.parent?.updateWorldMatrix(true, false);
                const inverse = node.parent?.matrixWorld.clone() ?? new T.Matrix4();
                if (!Number.isFinite(inverse.determinant()) || inverse.determinant() === 0) this.limited.add(node);
                else {
                    inverse.invert().multiply(frame?.matrixWorld ?? new T.Matrix4());
                    const delta = new T.Vector3(...edit.offset).applyMatrix3(new T.Matrix3().setFromMatrix4(inverse));
                    if (delta.toArray().every(Number.isFinite)) node.position.add(delta); else this.limited.add(node);
                }
            }
            if (edit.rotation) node.quaternion.multiply(new T.Quaternion().setFromEuler(new T.Euler(...edit.rotation)));
            if (edit.scale) node.scale.multiply(new T.Vector3(...edit.scale));
            if (edit.hidden !== undefined) { node.visible = node.visible && !edit.hidden; setModelNodeHidden(node, edit.hidden); }
            node.updateMatrix(); node.updateWorldMatrix(false, true);
        }
    }
}
