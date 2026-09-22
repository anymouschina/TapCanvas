import { ArrowHelper, Group, Mesh, MeshBasicMaterial, SphereGeometry, Vector3 } from 'three';
import { worldContactAnchors } from '../assets/contact-anchors.ts';
import { disposeTree } from '../assets/dispose.ts';
import type { Entity } from '../model.ts';

/** Editor-only visualization, outside model geometry and the actual camera layer. */
export class ContactMarker {
    root: Group | null = null;
    private target: { entityId: string; anchorId: string } | null = null;
    show(entityId: string, anchorId: string, parent: Group) {
        if (this.target?.entityId === entityId && this.target.anchorId === anchorId) return;
        if (this.root) disposeTree(this.root);
        this.root = null; this.target = null;
        if (!entityId || !anchorId) return;
        this.target = { entityId, anchorId }; this.root = new Group();
        this.root.add(new Mesh(new SphereGeometry(.025, 12, 8), new MeshBasicMaterial({ color: '#e7bd60', depthTest: false })),
            new ArrowHelper(new Vector3(0, 1, 0), new Vector3(), .24, '#e7bd60', .06, .035));
        this.root.traverse(node => { node.layers.set(1); node.renderOrder = 1000; }); parent.add(this.root);
    }
    update(entities: Entity[], models: Map<string, Group>) {
        if (!this.target || !this.root) return;
        const entity = entities.find(e => e.id === this.target!.entityId), model = entity && models.get(entity.id);
        const anchor = entity && model && worldContactAnchors(entity, model).find(a => a.id === this.target!.anchorId);
        this.root.visible = !!anchor && !!entity?.visible && !!model?.visible;
        if (anchor) { this.root.position.fromArray(anchor.position); this.root.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(...anchor.normal)); }
    }
}
