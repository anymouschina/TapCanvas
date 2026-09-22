import type { AppContext } from '../app-context.ts';
import type { Entity } from '../model.ts';
import { CONTACT_ROLES, contactAnchors } from '../assets/contact-anchors.ts';
import { estimateContact } from '../editor/contact-estimation.ts';
import { options } from './common.ts';
import './contact-anchor-editor.css';

export function createContactAnchorEditor(ctx: AppContext, refresh: () => void) {
    const content = document.querySelector<HTMLElement>('#inspector-content')!;
    let selected = '', parameter = 'y';
    const points = (e: Entity) => contactAnchors(e, ctx.engine.models.get(e.id)!);
    content.addEventListener('change', event => {
        const input = event.target as HTMLInputElement | HTMLSelectElement;
        if (!input.closest('.contact-editor')) return;
        event.stopPropagation(); const e = ctx.current(); if (!e || e.kind !== 'prop') return;
        if (input.id === 'contact-choice') { selected = input.value; refresh(); return; }
        if (input.id === 'contact-parameter') { parameter = input.value; refresh(); return; }
        if (e.locked || input.id !== 'contact-value') return;
        const current = points(e).find(p => p.id === selected);
        if (!current) return;
        const previous = parameter === 'role' ? current.role : parameter === 'yaw' ? Math.atan2(current.forward?.[0] ?? 0, current.forward?.[2] ?? 1) * 180 / Math.PI : current.position[['x', 'y', 'z'].indexOf(parameter)];
        if (parameter === 'role' ? previous === input.value : previous === Number(input.value)) return;
        ctx.change(() => {
            e.contactAnchors = points(e); const point = e.contactAnchors.find(p => p.id === selected); if (!point) throw Error('接触点不存在');
            if (parameter === 'role') point.role = input.value as typeof point.role;
            else if (parameter === 'yaw') { const radians = Number(input.value) * Math.PI / 180; point.forward = [Math.sin(radians), 0, Math.cos(radians)]; }
            else point.position[['x', 'y', 'z'].indexOf(parameter)] = Number(input.value);
        });
    });
    content.addEventListener('click', event => {
        const button = (event.target as HTMLElement).closest<HTMLElement>('[data-contact-action]'); if (!button) return;
        event.stopPropagation(); const e = ctx.current(); if (!e || e.kind !== 'prop' || e.locked) return;
        ctx.change(() => {
            const action = button.dataset.contactAction;
            if (action === 'reset') { delete e.contactAnchors; return; }
            e.contactAnchors = points(e);
            if (action === 'remove') { e.contactAnchors = e.contactAnchors.filter(p => p.id !== selected); return; }
            const point = action === 'estimate' ? estimateContact(ctx.engine.models.get(e.id)!, 'seat') : { id: crypto.randomUUID(), role: 'seat' as const, position: [0, .45, 0] as [number, number, number], normal: [0, 1, 0] as [number, number, number] };
            selected = point.id; e.contactAnchors.push(point);
        });
    });
    return { render(e: Entity) {
        const anchors = points(e); if (!anchors.some(p => p.id === selected)) selected = anchors[0]?.id ?? '';
        const point = anchors.find(p => p.id === selected);
        ctx.engine.showContactAnchor(e.id, selected);
        const parameters: [string, string][] = [['x', '局部 X / 米'], ['y', '局部 Y / 米'], ['z', '局部 Z / 米'], ['role', '接触用途'], ...(point && Math.abs(point.normal[1] - 1) < 1e-5 ? [['yaw', '面朝方向 / 度'] as [string, string]] : [])];
        if (!parameters.some(([key]) => key === parameter)) parameter = 'y';
        const value = parameter === 'role' ? `<select id="contact-value" aria-label="接触用途" ${point ? '' : 'disabled'}>${options(Object.entries(CONTACT_ROLES), point?.role ?? 'seat')}</select>`
            : `<input id="contact-value" type="number" aria-label="${parameters.find(([k]) => k === parameter)?.[1]}" step="${parameter === 'yaw' ? 5 : .01}" value="${point ? parameter === 'yaw' ? Math.atan2(point.forward?.[0] ?? 0, point.forward?.[2] ?? 1) * 180 / Math.PI : point.position[['x', 'y', 'z'].indexOf(parameter)] : 0}" ${point ? '' : 'disabled'}/>`;
        return `<div class="contact-editor" title="接触点使用对象局部坐标，随整体移动和缩放。估算结果需确认；自定义后改变模型尺寸须核对位置。"><div class="native-row"><select id="contact-choice" aria-label="接触点">${options(anchors.length ? anchors.map((p, i) => [p.id, `${e.contactAnchors ? '自定义' : '默认'} ${i + 1} · ${CONTACT_ROLES[p.role]}`]) : [['', '尚无接触点']], selected)}</select><button class="subtle" data-contact-action="remove" ${point ? '' : 'disabled'}>移除</button></div><div class="native-values"><select id="contact-parameter" aria-label="接触点参数">${options(parameters, parameter)}</select>${value}</div><div class="contact-actions"><button class="subtle" data-contact-action="estimate" title="从实际水平表面估算座位，使用前核对位置和用途">估算</button><button class="subtle" data-contact-action="add" title="手动添加接触点">添加</button><button class="subtle" data-contact-action="reset" title="清除自定义，恢复模型默认接触点">恢复</button></div></div>`;
    } };
}
