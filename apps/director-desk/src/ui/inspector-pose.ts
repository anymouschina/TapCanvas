import type { AppContext } from '../app-context.ts';
import { assetJoints } from '../asset-catalog.ts';
import type { Entity, Joint } from '../model.ts';
import { samplePose } from '../timeline.ts';
import { button, options } from './common.ts';
import type { InspectorNavigation } from './inspector-navigation.ts';

export function createPoseInspector(ctx: AppContext, navigation: InspectorNavigation, refresh: () => void) {
    let group = 0, keyIndex = 0;
    document.querySelector('#inspector-content')!.addEventListener('change', event => {
        const input = event.target as HTMLSelectElement;
        if (!['pose-group', 'pose-key-choice'].includes(input.id)) return;
        event.stopPropagation(); if (input.id === 'pose-group') group = Number(input.value); else keyIndex = Number(input.value); refresh();
    });
    return { render(e: Entity) {
        const joints = Object.entries(assetJoints(e.asset)), pageSize = e.locked || e.initialPose ? 3 : 4;
        const groups = Array.from({ length: Math.ceil(joints.length / pageSize) }, (_, index) => joints.slice(index * pageSize, index * pageSize + pageSize));
        group = Math.max(0, Math.min(groups.length - 1, group));
        const pose = samplePose(e, ctx.time);
        const controls = `<select id="pose-group" aria-label="选择关节分组">${options(groups.map((items, i) => [String(i), items.map(([, label]) => label).join(' · ')]), String(group))}</select><div class="pose-joints">${(groups[group] ?? []).map(([joint, label]) => `<label class="joint-field"><span>${label}</span><input type="range" data-joint="${joint}" min="${joint.includes('Knee') ? 0 : -160}" max="160" value="${pose[joint as Joint] ?? 0}"/><output>${Math.round(pose[joint as Joint] ?? 0)}°</output></label>`).join('')}</div><div class="button-row">${button('pose-reset', '复位', '', 'subtle')}${button('pose-mirror', '左右镜像', '', 'subtle')}</div>`;
        keyIndex = Math.max(0, Math.min(e.poseKeys.length - 1, keyIndex));
        const keys = !e.poseKeys.length ? '<div class="empty-state">尚未记录姿态关键帧</div>' : `<label class="field"><span>姿态关键帧</span><select id="pose-key-choice">${options(e.poseKeys.map((k, i) => [String(i), `${i + 1} · ${k.time.toFixed(2)} 秒`]), String(keyIndex))}</select></label><div class="button-row">${button('seek-key', '跳到此帧', '', 'subtle', `data-index="${keyIndex}"`)}${button('delete-key', '删除此帧', 'trash', 'subtle', `data-index="${keyIndex}"`)}</div>`;
        return navigation.render(`${e.id}:pose`, [{ id: 'joints', label: '调整关节', html: controls }, { id: 'keys', label: '姿态关键帧', html: keys }]);
    } };
}
