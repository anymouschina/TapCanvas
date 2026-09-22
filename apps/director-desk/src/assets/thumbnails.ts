import * as T from 'three';
import { findAsset } from '../asset-catalog.ts';
import { entity } from '../model.ts';
import { makeActor } from './actors.ts';
import { makeProp } from './props.ts';
import { disposeTree } from './dispose.ts';

const cache = new Map<string, string>();
let renderer: T.WebGLRenderer | undefined, queue: Promise<unknown> = Promise.resolve();
function paint(id: string) {
    const definition = findAsset(id); if (!definition) throw new Error('资产不存在');
    renderer ??= new T.WebGLRenderer({ antialias: true, alpha: false }); renderer.setSize(192, 132, false); renderer.setPixelRatio(1);
    const scene = new T.Scene(); scene.background = new T.Color('#232323');
    const object = entity(definition.kind, id, definition.name), root = new T.Group();
    try {
        if (definition.kind === 'crowd') for (let i = 0; i < 3; i++) {
            const person = makeActor(object); person.root.position.set((i - 1) * .65, 0, i % 2 * -.22); root.add(person.root);
        }
        else root.add(definition.kind === 'actor' ? makeActor(object).root : makeProp(object));
        scene.add(root); scene.add(new T.HemisphereLight(0xffffff, 0x666666, 2));
        const sun = new T.DirectionalLight(0xffffff, 2); sun.position.set(3, 6, 5); scene.add(sun);
        const bounds = new T.Box3().setFromObject(root, true), center = bounds.getCenter(new T.Vector3()), radius = bounds.getBoundingSphere(new T.Sphere()).radius;
        const camera = new T.PerspectiveCamera(35, 192 / 132, Math.max(.0001, radius / 1000), radius * 100 + 10);
        camera.position.copy(center).add(new T.Vector3(.8, .55, 1).normalize().multiplyScalar(radius / Math.sin(T.MathUtils.degToRad(17.5)) * 1.03)); camera.lookAt(center);
        renderer.render(scene, camera); return renderer.domElement.toDataURL('image/webp', .82);
    } finally { disposeTree(root); renderer.renderLists.dispose(); }
}
/** One renderer, a bounded cache, and at most one generation during an idle slice. */
export function thumbnail(id: string, wanted: () => boolean): Promise<string | null> {
    const task = queue.then(async () => {
        if (!wanted()) return null;
        const existing = cache.get(id);
        if (existing) { cache.delete(id); cache.set(id, existing); return existing; }
        await new Promise<void>(resolve => {
            if ('requestIdleCallback' in globalThis) requestIdleCallback(() => resolve(), { timeout: 500 });
            else requestAnimationFrame(() => resolve());
        });
        if (!wanted()) return null;
        const data = paint(id); cache.set(id, data);
        if (cache.size > 96) cache.delete(cache.keys().next().value!);
        return data;
    });
    queue = task.catch(() => undefined); return task;
}
