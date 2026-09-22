import * as T from 'three';
import type { AppContext } from '../app-context.ts';
import { COLORS, uid, type Vec3 } from '../model.ts';
import { zoneConnections } from '../building/zones.ts';
import { escape, options } from './common.ts';
import './native-animation-editor.css';
export function createZonePanel(ctx: AppContext) {
    let id = '';
    const input = (id: string) => document.getElementById(id) as HTMLInputElement;
    function render() {
        const zones = ctx.project.zones ?? [];
        if (!zones.some(z => z.id === id)) id = zones[0]?.id ?? '';
        const zone = zones.find(z => z.id === id), disabled = zone ? '' : 'disabled';
        ctx.showModal('空间区域', `<div class="native-editor" id="zone-editor"><p class="panel-help">为同一戏段的厨房、走廊等空间命名。区域线框只在布景显示，不改变建筑、人物或摄影机取景。</p><div class="native-row"><label>区域<select id="zone-choice">${options(zones.length ? zones.map((z, i) => [z.id, `${i + 1} · ${z.name}`]) : [['', '尚未创建区域']], id)}</select></label><button data-act="zone-new">新建区域</button></div><div class="native-values"><label>名称<input id="zone-name" maxlength="80" value="${escape(zone?.name ?? '')}" ${disabled}/></label><label>标记颜色<input id="zone-color" type="color" value="${zone?.color ?? COLORS[0]}" ${disabled}/></label></div>${['min', 'max'].map(k => `<div class="native-values">${[0, 1, 2].map(axis => `<label>${k === 'min' ? '起点' : '终点'} ${'XYZ'[axis]} / 米<input id="zone-${k}-${axis}" type="number" step=".1" value="${zone?.[k as 'min' | 'max'][axis] ?? (k === 'min' ? 0 : 3)}" ${disabled}/></label>`).join('')}</div>`).join('')}<div class="button-row"><button data-act="zone-fit" ${zone && ctx.current() ? '' : 'disabled'}>取选中对象边界</button><button data-act="zone-save" ${disabled}>保存区域</button><button data-act="zone-focus" ${disabled}>定位查看</button></div><div class="native-row"><label>与哪个区域连接<select id="zone-link">${options([['', '选择区域'], ...zones.filter(z => z.id !== id).map(z => [z.id, z.name] as [string, string])], '')}</select></label><button data-act="zone-connect" ${disabled}>连接 / 断开</button></div><label>已连接区域<input readonly aria-label="已连接区域" value="${escape(zoneConnections(ctx.project, id).map(other => zones.find(z => z.id === other)!.name).join('、') || '无')}"/></label><p class="panel-help">连接是人工说明，不会开门、打通墙壁或自动规划路线。</p></div>`, `<button data-act="zone-remove" ${disabled}>删除区域标记</button><button data-act="close-modal">关闭</button>`);
        input('zone-choice').onchange = () => { id = input('zone-choice').value; render(); };
    }
    return { handle(action: string) {
        if (!['zone-open', 'zone-new', 'zone-save', 'zone-remove', 'zone-fit', 'zone-focus', 'zone-connect'].includes(action)) return false;
        if (action === 'zone-open') { render(); return true; }
        const zone = ctx.project.zones?.find(z => z.id === id);
        if (action === 'zone-focus' && zone) { ctx.engine.focusBounds(new T.Box3(new T.Vector3(...zone.min), new T.Vector3(...zone.max))); ctx.closeModal(); return true; }
        if (action === 'zone-fit') {
            const root = ctx.engine.models.get(ctx.selected); if (!root) return true;
            const box = new T.Box3().setFromObject(root); if (box.isEmpty()) return true;
            box.expandByScalar(.05);
            for (const k of ['min', 'max'] as const) box[k].toArray().forEach((v, i) => { input(`zone-${k}-${i}`).value = v.toFixed(3); }); return true;
        }
        ctx.change(() => {
            const zones = ctx.project.zones ??= [];
            if (action === 'zone-new') { id = uid(); const p = ctx.engine.orbit.target; zones.push({ id, name: `区域 ${zones.length + 1}`, color: COLORS[zones.length % COLORS.length], min: [p.x - 2, Math.floor(p.y), p.z - 2], max: [p.x + 2, Math.floor(p.y) + 3, p.z + 2] }); }
            if (action === 'zone-save' && zone) { zone.name = input('zone-name').value.trim(); zone.color = input('zone-color').value; for (const k of ['min', 'max'] as const) zone[k] = [0, 1, 2].map(i => Number(input(`zone-${k}-${i}`).value)) as Vec3; }
            if (action === 'zone-remove') { ctx.project.zones = zones.filter(z => z.id !== id); for (const z of ctx.project.zones) if (z.connectsTo) z.connectsTo = z.connectsTo.filter(other => other !== id); }
            if (action === 'zone-connect' && zone) {
                const other = zones.find(z => z.id === input('zone-link').value); if (!other) return;
                if (zoneConnections(ctx.project, id).includes(other.id)) { zone.connectsTo = zone.connectsTo?.filter(z => z !== other.id); other.connectsTo = other.connectsTo?.filter(z => z !== id); }
                else { zone.connectsTo = [...(zone.connectsTo ?? []), other.id]; }
            }
        }, false); render(); return true;
    } };
}
