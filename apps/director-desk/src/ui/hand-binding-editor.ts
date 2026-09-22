import type { AppContext } from '../app-context.ts';
import type { Entity } from '../model.ts';
import { canBindHand, detachHandBinding, editBoundTransform } from '../animation/hand-binding.ts';
import { escape, options } from './common.ts';
import './native-animation-editor.css';

export function createHandBindingEditor(ctx: AppContext, refresh: () => void) {
    const content = document.querySelector<HTMLElement>('#inspector-content')!;
    let chosen = '', parameter = 'offset.0', owner = '', lastBinding = '';
    content.addEventListener('change', event => {
        const input = event.target as HTMLInputElement | HTMLSelectElement; if (!input.closest('.hand-binding-editor')) return;
        event.stopPropagation(); const e = ctx.current(); if (!e || e.kind !== 'prop') return;
        if (input.id === 'hand-target') { chosen = input.value; return; }
        if (input.id === 'hand-parameter') { parameter = input.value; refresh(); return; }
        if (input.id !== 'hand-value' || e.locked || !e.handBinding) return;
        const [field, index] = parameter.split('.'), key = field as 'offset' | 'rotation', value = Number(input.value) * (key === 'rotation' ? Math.PI / 180 : 1);
        if (e.handBinding[key][Number(index)] === value) return;
        ctx.change(() => { e.handBinding![key][Number(index)] = value; }, false);
    });
    content.addEventListener('click', event => {
        const button = (event.target as HTMLElement).closest<HTMLElement>('[data-hand-action]'); if (!button) return;
        event.stopPropagation(); const e = ctx.current(); if (!e || e.kind !== 'prop' || e.locked) return;
        ctx.change(() => {
            const root = ctx.engine.models.get(e.id)!;
            if (button.dataset.handAction === 'detach') { detachHandBinding(e, root); return; }
            const [actorId, hand] = JSON.parse(chosen) as [string, 'left' | 'right'];
            const actor = ctx.project.entities.find(a => a.id === actorId); if (!actor || !canBindHand(actor, hand)) throw Error('请先选择可用的人物手部');
            e.handBinding = { actorId, hand, offset: e.handBinding?.offset ?? [0, 0, 0], rotation: [0, 0, 0] };
            editBoundTransform(e, ctx.engine.handFrame(e.handBinding), undefined, [root.rotation.x, root.rotation.y, root.rotation.z]);
            e.path = null; ctx.engine.positionKeying = false;
        }, false);
    });
    return { render(e: Entity) {
        const choices: [string, string][] = ctx.project.entities.flatMap(actor => (['left', 'right'] as const).filter(hand => canBindHand(actor, hand))
            .map(hand => [JSON.stringify([actor.id, hand]), `${actor.name} · ${hand === 'left' ? '左手' : '右手'}`] as [string, string]));
        const bindingKey = JSON.stringify(e.handBinding ? [e.handBinding.actorId, e.handBinding.hand] : null);
        if (owner !== e.id || lastBinding !== bindingKey) { owner = e.id; lastBinding = bindingKey; chosen = ''; }
        if (!choices.some(([id]) => id === chosen)) chosen = e.handBinding ? JSON.stringify([e.handBinding.actorId, e.handBinding.hand]) : choices[0]?.[0] ?? '';
        const parameters: [string, string][] = ['offset', 'rotation'].flatMap(field => ['X', 'Y', 'Z'].map((axis, i) => [`${field}.${i}`, `${field === 'offset' ? '握持偏移' : '握持旋转'} ${axis} / ${field === 'offset' ? '米' : '度'}`] as [string, string]));
        const [field, index] = parameter.split('.'), value = e.handBinding?.[field as 'offset' | 'rotation'][Number(index)] ?? 0;
        const actor = ctx.project.entities.find(a => a.id === e.handBinding?.actorId);
        return `<div class="native-editor hand-binding-editor" title="绑定后全段跟随所选手部，原有路径会清除，可撤销。道具大小保持不变，可拖动和旋转调整握持；解除时保留当前帧位置。"><div class="native-row"><select id="hand-target" aria-label="绑定人物与手部">${options(choices.length ? choices : [['', '先添加人物或映射手部骨骼']], chosen)}</select><button class="subtle" data-hand-action="attach" ${choices.length ? '' : 'disabled'}>${e.handBinding ? '改绑' : '绑定'}</button></div><div class="native-values"><select id="hand-parameter" aria-label="握持调整参数">${options(parameters, parameter)}</select><input id="hand-value" aria-label="握持参数值" type="number" step="${field === 'offset' ? '.01' : '5'}" value="${Number((value * (field === 'rotation' ? 180 / Math.PI : 1)).toFixed(6))}" ${e.handBinding ? '' : 'disabled'}/></div><button class="wide subtle" data-hand-action="detach" title="${escape(actor ? `当前：${actor.name} · ${e.handBinding!.hand === 'left' ? '左手' : '右手'}` : '尚未绑定')}" ${e.handBinding ? '' : 'disabled'}>${actor ? '解除绑定 · 保留当前帧位置' : '尚未绑定'}</button></div>`;
    } };
}
