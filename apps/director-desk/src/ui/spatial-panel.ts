import type { AppContext } from '../app-context.ts';
import type { SpatialReport } from '../spatial/report.ts';
import { spatialRelationship } from '../spatial/report.ts';
import { formatSpatialReport } from '../spatial/format.ts';
import { download } from '../storage.ts';
import { $, button, options } from './common.ts';
import './spatial-panel.css';

export function createSpatialPanel(ctx: AppContext) {
    let report: SpatialReport | null = null, aKey = '', bKey = '', stale = true;
    function setStale(value: boolean) {
        stale = value;
        const status = document.querySelector('#spatial-status');
        if (status) status.textContent = value ? '参数已改变，请重新查询。' : `报告时刻 ${report!.time.toFixed(3)} 秒 · 查询不修改工程`;
        for (const el of document.querySelectorAll<HTMLButtonElement>('[data-spatial-result]')) el.disabled = value;
        if (!value) {
            $<HTMLButtonElement>('[data-act="spatial-focus-a"]').disabled = !report?.objects.find(o => o.key === aKey)?.entityId;
            $<HTMLButtonElement>('[data-act="spatial-focus-b"]').disabled = !report?.objects.find(o => o.key === bKey)?.entityId;
        }
    }
    function updateReport() {
        try {
            const timeInput = $<HTMLInputElement>('#spatial-time');
            if (!timeInput.value.trim()) throw new Error('请输入查询时间');
            const time = Number(timeInput.value), cameraId = $<HTMLSelectElement>('#spatial-camera').value;
            const nextA = $<HTMLSelectElement>('#spatial-a').value, nextB = $<HTMLSelectElement>('#spatial-b').value;
            if (nextA && nextA === nextB) throw new Error('请选择两个不同对象，或将 B 设为“不比较”');
            const queryKeys = [nextA, nextB].filter(key => report?.objects.some(o => o.key === key && o.kind !== 'camera'));
            const result = ctx.engine.spatialReport({ time, cameraId, occlusionKeys: queryKeys });
            aKey = nextA; bKey = nextB;
            report = result;
            $<HTMLTextAreaElement>('#spatial-report').value = formatSpatialReport(report, aKey, bKey);
            setStale(false);
        } catch (error) { setStale(true); ctx.toast((error as Error).message, true); }
    }
    function open() {
        ctx.playing = false; ctx.updateTimeUI();
        report = ctx.engine.spatialReport({ time: ctx.time, cameraId: ctx.preview });
        const entries = report.objects.map(o => [o.key, o.name] as [string, string]);
        aKey = report.objects.find(o => o.entityId === ctx.selected && o.memberIndex === null)?.key ?? entries[0][0];
        bKey = report.objects.find(o => o.key !== aKey && o.kind === 'actor')?.key ?? '';
        ctx.showModal('空间检查', `<div class="spatial-controls"><label>查询时间 / 秒<input id="spatial-time" type="number" min="0" max="${ctx.project.duration}" step="${1 / ctx.project.fps}" value="${ctx.time}"/></label><label>检查机位<select id="spatial-camera">${options([['program', '按切镜'], ...ctx.project.entities.filter(e => e.kind === 'camera').map(e => [e.id, e.name] as [string, string])], ctx.preview)}</select></label><label>对象 A<select id="spatial-a">${options(entries, aKey)}</select></label><label>比较对象 B<select id="spatial-b">${options([['', '不比较'], ...entries], bKey)}</select></label></div><div class="spatial-toolbar">${button('spatial-current', '使用播放头时间', '', 'subtle')}${button('spatial-run', '查询 / 重新检查', 'search', 'primary')}<span id="spatial-status" role="status"></span></div><textarea id="spatial-report" readonly aria-label="空间检查报告" spellcheck="false"></textarea>`,
            button('spatial-focus-a', '定位 A 并编辑', '', 'subtle', 'data-spatial-result') + button('spatial-focus-b', '定位 B 并编辑', '', 'subtle', 'data-spatial-result') + button('range-open', '检查一段时间', '', 'subtle') + button('spatial-text', '导出完整 TXT', '', 'subtle', 'data-spatial-result') + button('spatial-json', '导出完整 JSON', '', 'subtle', 'data-spatial-result'));
        $('.modal').classList.add('spatial-modal');
        $('.spatial-controls').addEventListener('input', () => setStale(true));
        $('.spatial-controls').addEventListener('change', () => setStale(true));
        updateReport();
    }
    function handle(action: string): boolean {
        if (!action.startsWith('spatial-')) return false;
        try {
            if (action === 'spatial-open') { open(); return true; }
            if (!document.querySelector('#spatial-report')) return true;
            if (action === 'spatial-run') { updateReport(); return true; }
            if (action === 'spatial-current') { $('#spatial-time').value = String(ctx.time); updateReport(); return true; }
            if (!report || stale) { ctx.toast('请先重新查询'); return true; }
            if (action === 'spatial-text' || action === 'spatial-json') {
                const comparison = aKey && bKey && aKey !== bKey ? spatialRelationship(report, aKey, bKey) : null;
                const json = action === 'spatial-json';
                const text = json ? JSON.stringify({ ...report, comparison }, null, 2) : '\uFEFF' + formatSpatialReport(report, aKey, bKey, true);
                download(new Blob([text], { type: json ? 'application/json' : 'text/plain;charset=utf-8' }), `${report.projectName}-空间报告-${report.time.toFixed(3)}s.${json ? 'json' : 'txt'}`);
            }
            if (action === 'spatial-focus-a' || action === 'spatial-focus-b') {
                const o = report.objects.find(o => o.key === (action === 'spatial-focus-a' ? aKey : bKey));
                if (o?.entityId) {
                    ctx.closeModal(); ctx.playing = false; ctx.preview = report.camera.id; ctx.seek(report.time);
                    ctx.selectEntity(o.entityId); ctx.setView('split'); ctx.engine.focus(o.entityId); ctx.renderCameras();
                    if (o.memberIndex !== null) ctx.toast('已定位所属群演组；组内成员通过群演参数调整');
                }
            }
        } catch (error) { ctx.toast((error as Error).message, true); }
        return true;
    }
    return { handle };
}
