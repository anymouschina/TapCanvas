import { Box3, CanvasTexture, Object3D, PerspectiveCamera, Scene, Sprite, SpriteMaterial, SRGBColorSpace, Vector3, WebGLRenderer } from 'three';
import type { Entity, Project } from '../model.ts';

export const hasReferenceLabel = (e: Entity) => e.kind === 'actor' || e.kind === 'crowd' || e.asset === 'shape-capsule';

/** Labels share the shot's camera and depth buffer, so preview, screenshots and video agree. */
export class ReferenceLabels {
    private scene = new Scene();
    private entries = new Map<string, { name: string; sprite: Sprite; ratio: number }>();
    private bounds = new Box3();
    private point = new Vector3();
    clear() {
        for (const { sprite } of this.entries.values()) { sprite.material.map?.dispose(); sprite.material.dispose(); }
        this.scene.clear(); this.entries.clear();
    }
    render(renderer: WebGLRenderer, camera: PerspectiveCamera, project: Project, models: Map<string, Object3D>, head: (id: string) => Object3D | undefined, povTarget = '') {
        if (!project.referenceLabels) return;
        const wanted = new Set<string>();
        for (const e of project.entities) {
            if (!hasReferenceLabel(e)) continue;
            const root = models.get(e.id);
            if (!root?.visible || !e.visible || e.id === povTarget) continue;
            wanted.add(e.id);
            let item = this.entries.get(e.id);
            if (!item || item.name !== e.name) {
                if (item) { this.scene.remove(item.sprite); item.sprite.material.map?.dispose(); item.sprite.material.dispose(); }
                const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d')!;
                ctx.font = '32px sans-serif';
                canvas.width = Math.min(2048, Math.ceil(ctx.measureText(e.name).width) + 24); canvas.height = 52;
                ctx.fillStyle = '#151515dd'; ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.font = '32px sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.fillStyle = '#ffffff';
                ctx.fillText(e.name, canvas.width / 2, canvas.height / 2, canvas.width - 20);
                const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace;
                const sprite = new Sprite(new SpriteMaterial({ map: texture, depthTest: true, depthWrite: false, toneMapped: false }));
                sprite.center.set(.5, 0); item = { name: e.name, sprite, ratio: canvas.width / canvas.height };
                this.entries.set(e.id, item); this.scene.add(sprite);
            }
            this.bounds.setFromObject(head(e.id) ?? root);
            if (this.bounds.isEmpty()) { item.sprite.visible = false; continue; }
            this.bounds.getCenter(item.sprite.position); item.sprite.position.y = this.bounds.max.y + .12;
            this.point.copy(item.sprite.position).applyMatrix4(camera.matrixWorldInverse);
            const depth = -this.point.z;
            item.sprite.visible = depth > camera.near && depth < camera.far;
            const height = 2 * Math.max(depth, camera.near) * Math.tan(camera.fov * Math.PI / 360) * .04;
            item.sprite.scale.set(height * item.ratio, height, 1);
        }
        for (const [id, item] of this.entries) if (!wanted.has(id)) {
            this.scene.remove(item.sprite); item.sprite.material.map?.dispose(); item.sprite.material.dispose(); this.entries.delete(id);
        }
        const autoClear = renderer.autoClear, autoReset = renderer.info.autoReset;
        try { renderer.autoClear = false; renderer.info.autoReset = false; renderer.render(this.scene, camera); }
        finally { renderer.autoClear = autoClear; renderer.info.autoReset = autoReset; }
    }
}
