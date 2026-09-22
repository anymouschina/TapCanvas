import { Box3, Matrix4, Mesh, PerspectiveCamera, Quaternion, Raycaster, Vector2, Vector3 } from 'three';
import type { Engine } from '../engine.ts';
import { frameBounds } from './geometry.ts';
import { lensProjection, lensSource } from '../cinematography/lens-projection.ts';
import { meshesOf, sceneTargets, type SceneTarget } from './scene-targets.ts';
export interface SampleVisibility {
    status: 'unblocked-samples' | 'partly-blocked-samples' | 'blocked-samples' | 'no-samples' | 'out-of-frame' | 'hidden' | 'not-facing-camera' | 'not-applicable';
    method: 'screen-grid-rays'; grid: number; targetSamples: number; unblocked: number;
    blockers: { key: string; name: string; samples: number }[];
}
export interface VisibilityResult { body: SampleVisibility; face: SampleVisibility; faceFacingCosine: number | null }
const blank = (status: SampleVisibility['status'], grid = 7): SampleVisibility => ({ status, method: 'screen-grid-rays', grid, targetSamples: 0, unblocked: 0, blockers: [] });
function meshBox(mesh: Mesh) { if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox(); return mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld); }

/** Rays first hit the target's actual geometry, then test closer scene surfaces. Fractions are samples, never pixel area. */
export function sampleVisibility(camera: PerspectiveCamera, meshes: Mesh[], all: SceneTarget[], grid = 7): SampleVisibility {
    if (!meshes.length) return blank('not-applicable', grid);
    const bounds = new Box3(); meshes.forEach(mesh => { mesh.updateWorldMatrix(true, false); bounds.union(meshBox(mesh)); });
    const rect = frameBounds(bounds, camera).rectangle;
    if (!rect) return blank('out-of-frame', grid);
    const owner = new Map<Mesh, SceneTarget>(); all.forEach(t => t.meshes.forEach(m => owner.set(m, t)));
    const targets = new Set(meshes), obstacles = [...owner.keys()].filter(m => !targets.has(m));
    const ray = new Raycaster(), cameraForward = camera.getWorldDirection(new Vector3()), blockers = new Map<string, { key: string; name: string; samples: number }>();
    let hitCount = 0, unblocked = 0;
    const view = new Matrix4().copy(camera.matrixWorldInverse);
    for (let y = 0; y < grid; y++) for (let x = 0; x < grid; x++) {
        const u = rect.left + (rect.right - rect.left) * (x + .5) / grid, v = rect.top + (rect.bottom - rect.top) * (y + .5) / grid;
        ray.setFromCamera(lensSource(new Vector2(u * 2 - 1, 1 - v * 2), camera.aspect, lensProjection(camera)), camera);
        const cosine = ray.ray.direction.dot(cameraForward);
        ray.near = camera.near / cosine; ray.far = camera.far / cosine;
        const target = ray.intersectObjects(meshes, false)[0];
        if (!target || -target.point.clone().applyMatrix4(view).z < camera.near - 1e-6) continue;
        hitCount++;
        ray.far = Math.max(ray.near, target.distance - 1e-4);
        const obstruction = ray.intersectObjects(obstacles, false)[0];
        if (!obstruction) unblocked++;
        else {
            const o = owner.get(obstruction.object as Mesh)!;
            const count = blockers.get(o.key) ?? { key: o.key, name: o.name, samples: 0 };
            count.samples++; blockers.set(o.key, count);
        }
    }
    return { status: !hitCount ? 'no-samples' : !unblocked ? 'blocked-samples' : unblocked === hitCount ? 'unblocked-samples' : 'partly-blocked-samples',
        method: 'screen-grid-rays', grid, targetSamples: hitCount, unblocked, blockers: [...blockers.values()].sort((a, b) => b.samples - a.samples || a.key.localeCompare(b.key)) };
}
export function visibilityChecks(engine: Engine, cameraId: string, keys: string[]): Map<string, VisibilityResult> {
    if (!keys.length) return new Map();
    const all = sceneTargets(engine, cameraId), camera = engine.getShotCamera(cameraId), result = new Map<string, VisibilityResult>();
    for (const key of new Set(keys)) {
        let target = all.find(t => t.key === key);
        if (!target && key.startsWith('entity:')) {
            const members = all.filter(t => t.entityId === key.slice(7));
            if (members.length) target = { ...members[0], key, meshes: members.flatMap(t => t.meshes), head: undefined, person: false };
        }
        if (!target) { result.set(key, { body: blank('hidden'), face: blank('not-applicable'), faceFacingCosine: null }); continue; }
        const body = sampleVisibility(camera, target.meshes, all);
        let face = blank('not-applicable'), faceFacingCosine: number | null = null;
        if (target.head) {
            const towardCamera = camera.getWorldPosition(new Vector3()).sub(target.head.getWorldPosition(new Vector3())).normalize();
            const forward = new Vector3(0, 0, 1).applyQuaternion(target.head.getWorldQuaternion(new Quaternion()));
            faceFacingCosine = forward.dot(towardCamera);
            face = faceFacingCosine <= .15 ? blank('not-facing-camera') : sampleVisibility(camera, meshesOf(target.head), all);
        }
        result.set(key, { body, face, faceFacingCosine });
    }
    return result;
}
