import * as T from 'three';
import type { FootSurface } from './foot-grounding.ts';
import { modelNodeHidden } from '../resources/model-node-visibility.ts';

/** Caller supplies already sampled props/room, excluding all actors and their own meshes. */
export function footSurfaceQuery(surfaces: T.Object3D[]): FootSurface {
    const ray = new T.Raycaster(); ray.ray.direction.set(0, -1, 0);
    return (point, reach) => {
        ray.ray.origin.copy(point); ray.ray.origin.y += reach; ray.far = reach * 2 + 1e-5;
        const hit = ray.intersectObjects(surfaces, true).find(h => !modelNodeHidden(h.object) && h.face && h.face.normal.clone().applyNormalMatrix(new T.Matrix3().getNormalMatrix(h.object.matrixWorld)).y > .5);
        // The editor's outdoor base plane is also at y=0 when no explicit room is present.
        return hit?.point.y ?? (Math.abs(point.y) <= reach + 1e-5 ? 0 : null);
    };
}
