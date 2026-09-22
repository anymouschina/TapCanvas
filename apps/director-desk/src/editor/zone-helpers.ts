import * as T from 'three';
import type { SceneZone } from '../building/zones.ts';
/** Editor-only annotation. Adding to Engine.helpers keeps it out of every camera/export. */
export function addZoneHelpers(parent: T.Group, zones: SceneZone[]) {
    zones.forEach((z, index) => {
        const box = new T.Box3(new T.Vector3(...z.min), new T.Vector3(...z.max));
        const helper = new T.Box3Helper(box, new T.Color(z.color));
        const material = helper.material as T.LineBasicMaterial;
        material.transparent = true; material.opacity = .5; parent.add(helper);
        const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 64;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#101010dd'; ctx.fillRect(0, 0, 512, 64); ctx.fillStyle = z.color;
        ctx.font = '28px sans-serif'; ctx.textBaseline = 'middle'; ctx.fillText(`${index + 1} · ${z.name}`, 12, 32, 488);
        const texture = new T.CanvasTexture(canvas);
        const label = new T.Sprite(new T.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
        label.material.addEventListener('dispose', () => texture.dispose());
        label.position.set((z.min[0] + z.max[0]) / 2, z.max[1] + .15, (z.min[2] + z.max[2]) / 2);
        const width = Math.min(4, Math.max(1.5, (z.max[0] - z.min[0]) * .65)); label.scale.set(width, width / 8, 1); label.renderOrder = 5; parent.add(label);
    });
}
