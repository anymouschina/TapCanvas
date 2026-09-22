import type { AppContext } from '../app-context.ts';
import { ASSETS, ASSET_GROUPS } from '../asset-catalog.ts';
import { applyOperations } from '../automation/edits.ts';
import { $, button, escape, options } from './common.ts';

export function createReplacePropPanel(ctx: AppContext) {
    let targetId = '', group = 'resources', selected = '';
    function render() {
        const e = ctx.project.entities.find(e => e.id === targetId); if (!e || e.kind !== 'prop') return;
        const list: [string, string][] = group === 'resources' ? (ctx.project.resources ?? []).map(r => [r.id, r.name]) : ASSETS.filter(a => a.kind === 'prop' && a.group === group).map(a => [a.id, a.name]);
        if (!list.some(([id]) => id === selected)) selected = list[0]?.[0] ?? '';
        const same = e.external?.resourceId === selected, old = same ? e.external : null;
        ctx.showModal('替换选中道具', `<p class="panel-help">${escape(e.name)}：保留对象编号、站位、旋转缩放、路径、手持和机位引用。不同资产的几何参数、手调姿态及接触点会重置；尺寸按新模型确定，请检查比例。</p><div class="resource-row"><select id="replace-group" aria-label="替换资产分类">${options([['resources', '工程导入资源'], ...ASSET_GROUPS.filter(g => ASSETS.some(a => a.kind === 'prop' && a.group === g)).map(g => [g, g] as [string, string])], group)}</select><select id="replace-asset" aria-label="替换资产">${options(list.length ? list : [['', '此分类暂无资源']], selected)}</select></div>${group === 'resources' ? `<div class="field-pair"><label class="field"><span>单位换算到米</span><input id="replace-units" type="number" min=".000001" step=".01" value="${old?.unitScale ?? 1}"/></label><label class="field"><span>显示方式</span><select id="replace-appearance">${options([['original', '原材质'], ['white', '白模'], ['color', '识别色']], old?.appearance ?? 'original')}</select></label></div><div class="triple">${['X', 'Y', 'Z'].map((axis, i) => `<label class="field"><span>${axis} 轴校正 / 度</span><input id="replace-axis-${i}" type="number" step="90" value="${(old?.orientation[i] ?? 0) * 180 / Math.PI}"/></label>`).join('')}</div>` : ''}<label class="field"><span>原生动画片段</span><select id="replace-animation">${options([['preserve', '保留（不同源模型将阻止替换）'], ['clear', '明确清除原生动画片段']], 'preserve')}</select></label><p class="panel-help">建筑连接会重新验证和对齐。新资产没有对应接口时请先解除连接；锁定的关联对象保持受保护。需要新模型时，可先到“工程模型资源”导入。</p>`, button('close-modal', '取消', '', 'subtle') + button('replace-prop-apply', '替换', '', 'primary', selected && !e.locked ? '' : 'disabled'));
        $('#replace-group').addEventListener('change', () => { group = $('#replace-group').value; selected = ''; render(); });
        $('#replace-asset').addEventListener('change', () => { selected = $('#replace-asset').value; render(); });
    }
    return { handle(action: string) {
        if (action === 'replace-prop-open') { targetId = ctx.current()?.id ?? ''; group = ctx.project.resources?.length ? 'resources' : '家具'; selected = ctx.current()?.external?.resourceId ?? ''; render(); }
        else if (action === 'replace-prop-apply') {
            try {
                const patch = { animation: $('#replace-animation').value, ...(group === 'resources' ? { unitScale: Number($('#replace-units').value), appearance: $('#replace-appearance').value,
                    orientation: [0, 1, 2].map(i => Number($(`#replace-axis-${i}`).value) * Math.PI / 180) } : {}) };
                const next = applyOperations(ctx.project, [{ operation: 'replace-prop', id: targetId, asset: selected, patch }]);
                if (ctx.change(() => { ctx.project = next; })) { ctx.closeModal(); ctx.toast('已替换道具；站位与路径保持，请检查新模型尺寸及周围通行空间'); }
            } catch (error) { ctx.toast((error as Error).message, true); }
        } else return false;
        return true;
    } };
}
