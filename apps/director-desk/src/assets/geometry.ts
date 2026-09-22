import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
export function material(color: T.ColorRepresentation) { return new T.MeshStandardMaterial({ color, roughness: .78, metalness: .02 }); }
export function mesh(parent: T.Object3D, g: T.BufferGeometry, m: T.Material, x = 0, y = 0, z = 0) { const o = new T.Mesh(g, m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; parent.add(o); return o; }
export function box(parent: T.Object3D, m: T.Material, w: number, h: number, d: number, x = 0, y = 0, z = 0, r = .012) { return mesh(parent, new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 4, h / 4, d / 4)), m, x, y, z); }
export function sphere(parent: T.Object3D, m: T.Material, x: number, y: number, z: number, sx: number, sy = sx, sz = sx) { const s = mesh(parent, new T.SphereGeometry(1, 16, 12), m, x, y, z); s.scale.set(sx, sy, sz); return s; }
export function cylinder(parent: T.Object3D, m: T.Material, top: number, bottom: number, height: number, x = 0, y = 0, z = 0) { return mesh(parent, new T.CylinderGeometry(top, bottom, height, 16), m, x, y, z); }
