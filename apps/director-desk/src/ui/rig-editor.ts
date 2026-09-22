import type { AppContext } from '../app-context.ts';
import type { Entity } from '../model.ts';
import { HUMAN_BONES, rigStatus, type HumanBone } from '../resources/rig-definition.ts';
import { escape, options } from './common.ts';
import './rig-editor.css';
import { nativeSample } from '../resources/native-animation.ts';
import { activeClip } from '../timeline.ts';

export function createRigEditor(ctx: AppContext, refresh: () => void) {
    const content = document.querySelector<HTMLElement>('#inspector-content')!;
    let view = 'mapping', part: HumanBone = 'hips', bonePath = '', owner = '';
    const infoFor = (e: Entity) => ctx.engine.externalModels.inspection(ctx.project.resources!.find(r => r.id === e.external!.resourceId)!);
    content.addEventListener('change', event => {
        const target = event.target as HTMLInputElement | HTMLSelectElement;
        if (!target.closest('.rig-editor')) return;
        event.stopPropagation(); const e = ctx.current(); if (!e?.external) return;
        if (target.id === 'rig-view') { view = target.value; if (view === 'pose') bonePath = e.external.rig?.bones[part] ?? bonePath; refresh(); return; }
        if (target.id === 'rig-part') { part = target.value as HumanBone; refresh(); return; }
        if (target.id === 'rig-bone' && view === 'pose') { bonePath = target.value; refresh(); return; }
        if (e.locked) return;
        if (target.id === 'rig-bone') ctx.change(() => {
            e.external!.rig ??= { version: 1, family: 'humanoid', bones: {} };
            if (target.value) e.external!.rig.bones[part] = target.value; else delete e.external!.rig.bones[part];
        });
        else if (target.dataset.rigAxis !== undefined) {
            const changed = ctx.change(() => {
                const pose = e.external!.defaultPose ??= {}, angles = pose[bonePath] ??= [0, 0, 0];
                angles[Number(target.dataset.rigAxis)] = Number(target.value) * Math.PI / 180;
                if (angles.every(v => v === 0)) delete pose[bonePath];
                if (!Object.keys(pose).length) delete e.external!.defaultPose;
            });
            if (changed && activeClip(e, ctx.time)?.action === 'retarget') ctx.toast('参考姿态已更新，适配动作将按新姿态重新计算。');
            else if (changed && nativeSample(e, ctx.time)) ctx.toast('默认姿态已保存；移到原生动画片段外可查看。');
        }
    });
    content.addEventListener('click', event => {
        const button = (event.target as HTMLElement).closest<HTMLElement>('[data-rig-action]');
        if (!button) return; event.stopPropagation(); const e = ctx.current(); if (!e?.external) return;
        const action = button.dataset.rigAction;
        if (action === 'focus') {
            const path = view === 'mapping' ? e.external.rig?.bones[part] : bonePath;
            if (path) { ctx.engine.orbit.target.copy(ctx.engine.externalModels.bonePosition(e.id, path)); ctx.engine.orbit.update(); }
            return;
        }
        if (e.locked) return;
        ctx.change(() => {
            if (action === 'auto') e.external!.rig = structuredClone(infoFor(e).rigSuggestion.rig);
            if (action === 'clear') delete e.external!.rig;
            if (action === 'reset-all') delete e.external!.defaultPose;
            if (action === 'reset-one') {
                if (e.external!.defaultPose) delete e.external!.defaultPose[bonePath];
                if (!Object.keys(e.external!.defaultPose ?? {}).length) delete e.external!.defaultPose;
            }
        });
    });
    return { render(e: Entity) {
        const info = infoFor(e), rig = e.external!.rig;
        if (owner !== e.id) { owner = e.id; bonePath = rig?.bones[part] ?? info.bones[0]?.path ?? ''; }
        if (!info.bones.some(b => b.path === bonePath)) bonePath = info.bones[0]?.path ?? '';
        if (e.kind !== 'actor') view = 'pose';
        const status = rigStatus(rig), missing = status.missing.map(key => HUMAN_BONES[key]).join('、');
        const modes: [string, string][] = [...(e.kind === 'actor' ? [['mapping', `映射 ${status.requiredMapped} / ${status.requiredMapped + status.missing.length}`]] as [string, string][] : []), ['pose', '默认姿态']];
        const select = (id: string, label: string, choices: [string, string][], value: string) => `<select id="${id}" aria-label="${label}" title="${escape(choices.find(([key]) => key === value)?.[1] ?? label)}" ${id === 'rig-bone' && view === 'pose' ? 'data-rig-readonly="true"' : ''}>${options(choices, value)}</select>`;
        const bones = info.bones.map(b => {
            const mapped = Object.entries(rig?.bones ?? {}).find(([, path]) => path === b.path)?.[0] as HumanBone | undefined;
            return [b.path, `${view === 'pose' && mapped ? HUMAN_BONES[mapped] + ' · ' : ''}${b.name || '未命名骨骼'} · ${b.path}`] as [string, string];
        });
        const button = (action: string, label: string) => `<button data-rig-action="${action}" class="subtle">${label}</button>`;
        const mode = select('rig-view', '骨架编辑方式', modes, view);
        if (view === 'mapping') {
            return `<div class="rig-editor" title="${escape(missing ? '待映射：' + missing : '映射齐全；自然动作适配尚未接入')}"><div class="rig-pair">${mode}${select('rig-part', '人体部位', Object.entries(HUMAN_BONES), part)}</div>${select('rig-bone', '对应源骨骼', [['', '未映射'], ...bones], rig?.bones[part] ?? '')}<div class="rig-buttons">${button('auto', '自动识别')}${button('clear', '清除映射')}${button('focus', '定位')}</div></div>`;
        }
        const angles = e.external!.defaultPose?.[bonePath] ?? [0, 0, 0];
        return `<div class="rig-editor" title="局部 XYZ 旋转／度；默认姿态随工程保存，仅在原生动画片段外显示；通用动作适配待完成"><div class="rig-pair">${mode}${select('rig-bone', '调整源骨骼', bones, bonePath)}</div><div class="rig-angles">${['X', 'Y', 'Z'].map((axis, i) => `<label>${axis}<input type="number" data-rig-axis="${i}" aria-label="局部 ${axis} 旋转／度" min="-360" max="360" step="1" value="${Number((angles[i] * 180 / Math.PI).toFixed(4))}"/></label>`).join('')}</div><div class="rig-buttons">${button('reset-one', '此骨骼复位')}${button('reset-all', '全部复位')}${button('focus', '定位')}</div></div>`;
    } };
}
