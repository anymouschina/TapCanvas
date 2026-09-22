import type { AppContext } from '../app-context.ts';
import { applyPathSurfaceCorrections, checkPathSurfaces, pathSurfaceModels, ROOM_FLOOR_SURFACE, type PathSurfaceReport } from '../spatial/path-surfaces.ts';
import { $, button, options } from './common.ts';
import './spatial-panel.css';
import './path-surface-panel.css';

export function createPathSurfacePanel(ctx: AppContext) {
    let report: PathSurfaceReport | null = null, entityId = '';
    const labels = { 'on-surface': '贴合', above: '悬空', below: '穿入', ambiguous: '多层歧义', 'no-surface': '未找到承托面' };
    function run() {
        report = null; $<HTMLButtonElement>('[data-act="surface-apply"]').disabled = true;
        try {
            report = checkPathSurfaces(ctx.project, pathSurfaceModels(ctx.engine), { entityId, surfaceId: $('#surface-target').value || undefined, clearance: Number($('#surface-clearance').value), tolerance: .03 });
            const counts = Object.fromEntries(Object.keys(labels).map(k => [k, report!.points.filter(p => p.status === k).length]));
            $('#surface-summary').textContent = `检查 ${report.points.length} 处：贴合 ${counts['on-surface']}，悬空 ${counts.above}，穿入 ${counts.below}，歧义 ${counts.ambiguous}，无承托 ${counts['no-surface']}。`;
            $('#surface-report').value = report.points.filter(p => p.status !== 'on-surface').map(p => `${p.waypointIndex === null ? '段内' : '途经点 ' + (p.waypointIndex + 1)} · 源时间 ${p.sourceTime.toFixed(3)} 秒 · ${labels[p.status]}\n位置 (${p.position.map(v => v.toFixed(3)).join(', ')}) 米${p.suggested ? '；建议 Y=' + p.suggested[1].toFixed(3) : ''}${p.candidates.length ? '\n表面：' + p.candidates.map(c => `${c.entityId === ROOM_FLOOR_SURFACE ? '房间地板' : ctx.project.entities.find(e => e.id === c.entityId)?.name ?? c.entityId} @ ${c.height.toFixed(3)} 米`).join('；') : ''}`).join('\n\n') || '已采样位置均在容差内。';
            $('#surface-report').value += '\n\n' + report.limitations.join('\n');
            $<HTMLButtonElement>('[data-act="surface-apply"]').disabled = !!ctx.project.entities.find(e => e.id === entityId)?.locked || !report.points.some(p => p.waypointIndex !== null && p.suggested && ['above', 'below'].includes(p.status));
        } catch (error) { $('#surface-summary').textContent = (error as Error).message; $('#surface-report').value = ''; }
    }
    return { handle(action: string) {
        if (!action.startsWith('surface-')) return false;
        if (action === 'surface-open') {
            const e = ctx.current(); if (!e?.path || e.handBinding) { ctx.toast('先选择有独立路径的对象'); return true; }
            entityId = e.id; ctx.playing = false; ctx.updateTimeUI();
            ctx.showModal('检查路径承托面', `<div class="spatial-controls"><label>检查对象<select id="surface-target">${options([['', '全部静态承托面'], ...(ctx.project.room.enabled ? [[ROOM_FLOOR_SURFACE, '房间地板'] as [string, string]] : []), ...ctx.project.entities.filter(s => s.kind === 'prop' && s.visible && !s.handBinding && s.id !== e.id).map(s => [s.id, s.name] as [string, string])], '')}</select></label><label>高于表面 / 米<input id="surface-clearance" type="number" min="0" max="100" step=".05" value="0"/></label></div><p id="surface-summary" role="status"></p><textarea id="surface-report" readonly aria-label="路径承托面检查结果"></textarea>`, button('surface-run', '重新检查', '', 'subtle') + button('surface-apply', '校正可确定的途经点', '', 'primary') + button('close-modal', '关闭', '', 'subtle'));
            $('.modal').classList.add('spatial-modal'); $('.spatial-controls').addEventListener('change', run); run(); return true;
        }
        if (!document.querySelector('#surface-report')) return true;
        if (action === 'surface-run') run();
        else if (action === 'surface-apply' && report) {
            const current = report;
            if (ctx.change(() => { applyPathSurfaceCorrections(ctx.project, current); }, false)) { run(); ctx.toast('已校正途经点高度；请复查段内提示，必要时增加路线点'); }
        }
        return true;
    } };
}
