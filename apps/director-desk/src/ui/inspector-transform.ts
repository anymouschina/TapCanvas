import * as T from 'three';
import type { AppContext } from '../app-context.ts';
import type { Entity } from '../model.ts';
import { entityPosition } from '../timeline.ts';
import { escape, num } from './common.ts';

export function transformInspector(ctx: AppContext, e: Entity) {
    const camera = e.camera ? ctx.engine.getShotCamera(e.id) : null;
    const position = e.handBinding ? new T.Vector3(...e.handBinding.offset) : camera?.position ?? entityPosition(e, ctx.time);
    const rotation = e.handBinding ? e.handBinding.rotation : camera ? [camera.rotation.x, camera.rotation.y, camera.rotation.z] : e.rotation;
    const label = e.handBinding ? '握持偏移 · 随手部旋转' : e.camera && e.camera.mode !== 'free' ? '当前机位位置 · 修改会解除绑定' : e.structureLink ? '连接模块位置 · 修改接缝偏移' : ctx.engine.positionKeying ? '位置关键帧 · 修改记录到当前时间' : e.path ? '整体平移 · 对象与路径一起移动' : '初始位置';
    const row = (label: string, help: string, fields: string) => `<div class="transform-row"><span title="${escape(help)}">${label}</span><div class="triple">${fields}</div></div>`;
    return '<div class="transform-matrix">'
        + row('位置', label + ' · 米', ['X', 'Y', 'Z'].map((axis, i) => num(axis, (e.handBinding ? 'handOffset.' : 'pos.') + i, position.getComponent(i))).join(''))
        + row('旋转', (e.handBinding ? '握持旋转' : '旋转') + ' · 度', ['X', 'Y', 'Z'].map((axis, i) => num(axis, (e.handBinding ? 'handRotation.' : 'rot.') + i, T.MathUtils.radToDeg(rotation[i]), '1')).join(''))
        + (e.kind !== 'actor' ? row('缩放', '各轴整体缩放倍数', ['X', 'Y', 'Z'].map((axis, i) => num(axis, 'scale.' + i, e.scale[i], '.05', 'min=".05"')).join('')) : '') + '</div>';
}
