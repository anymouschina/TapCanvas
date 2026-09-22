import { Quaternion, Euler, Vector3 } from 'three';
import type { Entity, Vec3 } from '../model.ts';
import { propParameters } from '../parametric-props.ts';
import { assetParameters } from '../assets/parameters.ts';

/** Local surface-edge points. Yaw points out of the module, radians about local Y. */
export interface StructurePort { id: string; name: string; position: Vec3; yaw: number }
export function structurePorts(e: Entity): StructurePort[] {
    if (e.kind !== 'prop' || e.external) return [];
    const ports: StructurePort[] = [];
    const add = (id: string, name: string, position: Vec3, yaw: number) => ports.push({ id, name, position, yaw });
    const rect = (width: number, length: number, y: number) => {
        add('in', '前边', [0, y, length / 2], 0); add('out', '后边', [0, y, -length / 2], Math.PI);
        add('left', '左边', [-width / 2, y, 0], -Math.PI / 2); add('right', '右边', [width / 2, y, 0], Math.PI / 2);
    };
    const legacy = ['stairs', 'road', 'ground', 'wall'].includes(e.asset);
    const p = legacy ? propParameters(e) : assetParameters(e);
    if (e.asset === 'stairs' || e.asset.startsWith('structure-stairs-') && e.asset !== 'structure-stairs-spiral') {
        const n = p.steps, h = n * p.rise, last = -(n - 1) * p.tread;
        const style = legacy ? propParameters(e).layout : e.asset.replace('structure-stairs-', '');
        add('in', '下口', [0, 0, p.tread / 2], 0);
        if (style === 'straight') add('out', '上口', [0, h, last - p.tread / 2], Math.PI);
        else if (style === 'crest') add('out', '另一侧下口', [0, 0, last - p.landing - n * p.tread - p.tread / 2], Math.PI);
        else if (style === 'l') add('out', '转角上口', [p.width / 2 + n * p.tread, h * 2, last - p.tread / 2 - p.landing / 2], Math.PI / 2);
        else add('out', '折返上口', [p.width + (legacy ? 0 : .2), h * 2, p.tread / 2], 0);
    } else if (e.asset === 'structure-stairs-spiral' || e.asset === 'road-curve') {
        const p = assetParameters(e), radius = e.asset === 'road-curve' ? p.radius : p.radius - p.width / 2, angle = p.turn * Math.PI / 180;
        add('in', '起端', [radius, 0, 0], Math.PI);
        add('out', '末端', [radius * Math.cos(angle), e.asset === 'road-curve' ? 0 : p.steps * p.rise, radius * Math.sin(angle)], -angle);
    } else if (e.asset === 'structure-ramp') {
        add('in', '坡底', [0, 0, p.length / 2], 0); add('out', '坡顶', [0, p.height, -p.length / 2], Math.PI);
    } else if (['wall', 'structure-wall', 'structure-beam', 'structure-railing'].includes(e.asset)) {
        const width = e.asset === 'wall' || e.asset === 'structure-railing' ? p.length : p.width;
        add('in', '左端', [-width / 2, 0, 0], -Math.PI / 2); add('out', '右端', [width / 2, 0, 0], Math.PI / 2);
    } else if (e.asset === 'structure-slab') rect(p.width, assetParameters(e).depth, p.height);
    else if (['ground', 'road', 'road-straight', 'road-junction', 'road-sidewalk', 'road-curb', 'road-parking', 'road-bridge'].includes(e.asset)) {
        rect(e.asset === 'road-junction' ? p.length : p.width, p.length, ['road-sidewalk', 'road-curb'].includes(e.asset) ? p.height : 0);
    }
    return ports;
}
export function worldStructurePorts(e: Entity) {
    const q = new Quaternion().setFromEuler(new Euler(...e.rotation));
    return structurePorts(e).map(port => ({ ...port,
        position: new Vector3(...port.position).multiply(new Vector3(...e.scale)).applyQuaternion(q).add(new Vector3(...e.position)).toArray() as Vec3,
        outward: new Vector3(Math.sin(port.yaw) * e.scale[0], 0, Math.cos(port.yaw) * e.scale[2]).normalize().applyQuaternion(q).toArray() as Vec3,
    }));
}
