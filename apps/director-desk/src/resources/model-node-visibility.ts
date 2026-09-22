import type { Object3D } from 'three';
const hiddenNodes = new WeakSet<Object3D>();
export function setModelNodeHidden(node: Object3D, hidden: boolean) { if (hidden) hiddenNodes.add(node); else hiddenNodes.delete(node); }
/** Instance-authored hiding only. Editor visibility flags never enter geometry queries. */
export function modelNodeHidden(node: Object3D) {
    for (let current: Object3D | null = node; current; current = current.parent) if (hiddenNodes.has(current)) return true;
    return false;
}
