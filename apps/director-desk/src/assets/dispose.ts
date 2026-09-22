import * as T from 'three';
export function disposeTree(root: T.Object3D) { const geometries = new Set<T.BufferGeometry>(), materials = new Set<T.Material>(); root.traverse(o => { if (o instanceof T.Light) o.dispose(); const m = o as T.Mesh; if (m.geometry)
    geometries.add(m.geometry); if (m.material)
    for (const x of Array.isArray(m.material) ? m.material : [m.material])
        materials.add(x); }); geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); root.removeFromParent(); }
