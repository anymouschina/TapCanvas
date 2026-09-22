import { Vector3 } from 'three';
import { clone, type Entity, type Vec3 } from '../model.ts';
import type { ContactAnchor } from '../assets/contact-anchors.ts';
import { makeHuman, scaleHuman } from '../assets/humanoid.ts';
import { sampleHumanAction } from '../assets/human-animation.ts';
import { geometryBounds } from '../spatial/geometry.ts';
import { disposeTree } from '../assets/dispose.ts';
import { isAnimalAsset } from '../asset-catalog.ts';

/** Static blocking command. Measures the actual seated pelvis, instead of assuming one actor/chair size. */
export function seatedPlacement(actor: Entity, seat: ContactAnchor): { position: Vec3; yaw: number } {
    if (actor.kind !== 'actor' || actor.external || isAnimalAsset(actor.asset)) throw Error('当前座面定位支持内置人形');
    if (!['seat', 'bed'].includes(seat.role) || seat.normal[1] < .98) throw Error('请选择平缓的座位或床面接触点');
    if (Math.abs(actor.rotation[0]) > 1e-5 || Math.abs(actor.rotation[2]) > 1e-5) throw Error('座面定位需要人物保持直立方向，请先清除 X、Z 旋转');
    const e = clone(actor); e.pose = {}; e.poseKeys = []; e.clips = [{ id: 'placement', action: 'sit', start: 0, end: 1, speed: 1 }];
    const rig = makeHuman(e);
    try {
        scaleHuman(rig, e); sampleHumanAction(rig, e, .5); rig.root.updateWorldMatrix(true, true);
        const pelvis = rig.hips.children.filter(n => !Object.values(rig.joints).includes(n as never)).map(n => geometryBounds(n)).filter(b => b !== null);
        if (!pelvis.length) throw Error('人物没有可测量的座面接触几何');
        const bottom = Math.min(...pelvis.map(b => b.min.y)), hip = rig.hips.getWorldPosition(new Vector3());
        const forward = seat.forward ?? [0, 0, 1], yaw = Math.atan2(forward[0], forward[2]);
        const offset = new Vector3(hip.x, bottom, hip.z).applyAxisAngle(new Vector3(0, 1, 0), yaw);
        return { position: new Vector3(...seat.position).sub(offset).toArray(), yaw };
    } finally { disposeTree(rig.root); }
}
