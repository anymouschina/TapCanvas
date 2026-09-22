import { Object3D, Vector3 } from 'three';
import { clip, entity, type Entity, type Project, type Vec3 } from '../model.ts';

/** Small shared helpers for authored templates; all results remain ordinary editable entities. */
export function templateBuilder(p: Project) {
    const add = (kind: Entity['kind'], asset: string, name: string, position: Vec3, color: string, scale: Vec3 = [1,1,1]) => {
        const e = entity(kind, asset, name, position); e.color = color; e.scale = scale; p.entities.push(e); return e;
    };
    const box = (name: string, position: Vec3, scale: Vec3, color = '#697587') => add('prop', 'cube', name, position, color, scale);
    const actor = (name: string, position: Vec3, color: string) => {
        const e = add('actor', 'person', name, position, color); e.clips = [clip('idle', 0, p.duration)]; return e;
    };
    const light = (asset: string, name: string, position: Vec3, target: Vec3, color: string, intensity: number) => {
        const e = add('prop', asset, name, position, color); e.light!.intensity = intensity; e.light!.range = 35;
        // Lights emit along local -Z; Object3D.lookAt faces +Z.
        const look = new Object3D(); look.position.fromArray(position); look.lookAt(new Vector3(...position).multiplyScalar(2).sub(new Vector3(...target)));
        e.rotation = [look.rotation.x, look.rotation.y, look.rotation.z]; return e;
    };
    const camera = (name: string, position: Vec3, target: Vec3, focal: number, start = 0) => {
        const e = add('camera', 'camera', name, position, '#dddddd'); e.camera!.target = target; e.camera!.focal = focal;
        p.cuts.push({ time: start, cameraId: e.id }); return e;
    };
    return {add,box,actor,light,camera};
}
