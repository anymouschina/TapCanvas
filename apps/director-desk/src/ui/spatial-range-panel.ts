import type { AppContext } from '../app-context.ts';
import { scanSpatialRange, type SpatialRangeOptions, type SpatialRangeReport } from '../spatial/range.ts';
import { download } from '../storage.ts';
import { $, button, options } from './common.ts';

export function createSpatialRangePanel(ctx: AppContext) {
    let report: SpatialRangeReport | null = null, aborter: AbortController | null = null, stale = true;
    function output(full = false) {
        if (!report) return '';
        const finding = report.findings.find(f => f.id === $('#range-finding').value);
        const list = full ? report.findings : finding ? [finding] : [];
        return [`${report.projectName} · 区间检查`, `${report.complete ? '已完成' : '未完成全部检查（达到结果上限）'}：${report.processedSamples} / ${report.samples} 个采样点`,
            `${report.options.start}—${report.options.end} 秒；${report.options.sampleFps} 次/秒；共 ${report.findings.length} 段待确认情况`,
            '画外与裁切可以是导演有意安排；潜在穿插不等于精确碰撞。', '',
            ...list.flatMap(f => [`${f.id} · ${f.start.toFixed(3)}—${f.end.toFixed(3)} 秒`, f.description, `目标：${f.targetName}${f.otherName ? '；对方：' + f.otherName : ''}`, '']),
            ...report.limitations].join('\n');
    }
    function setStale() {
        stale = true; report = null;
        document.querySelectorAll<HTMLButtonElement>('[data-range-result]').forEach(b => b.disabled = true);
        if ($('#range-progress')) $('#range-progress').textContent = '条件已更改，请重新检查。';
    }
    function open() {
        const inheritedA = document.querySelector<HTMLSelectElement>('#spatial-a')?.value;
        const inheritedCamera = document.querySelector<HTMLSelectElement>('#spatial-camera')?.value ?? ctx.preview;
        ctx.playing = false; ctx.updateTimeUI(); report = null; stale = true;
        const snapshot = ctx.engine.spatialReport();
        const entries = snapshot.objects.filter(o => o.enabled && o.kind !== 'camera').map(o => [o.key, o.name] as [string, string]);
        const selected = entries.some(([key]) => key === inheritedA) ? inheritedA! : entries.find(([key]) => key === `entity:${ctx.selected}`)?.[0] ?? 'all-people';
        ctx.showModal('区间空间检查', `<div class="spatial-controls range-controls"><label>开始 / 秒<input id="range-start" type="number" min="0" value="0"/></label><label>结束 / 秒<input id="range-end" type="number" min="0" value="${ctx.project.duration}"/></label><label>检查对象<select id="range-target">${options([['all-people', '全部人物与群演'], ...entries], selected)}</select></label><label>对照范围<select id="range-compare">${options([['', '全部人物与障碍'], ...entries], '')}</select></label><label>检查机位<select id="range-camera">${options([['program', '按切镜'], ...ctx.project.entities.filter(e => e.kind === 'camera').map(e => [e.id, e.name] as [string, string])], inheritedCamera)}</select></label><label>采样次数 / 秒<input id="range-fps" type="number" min="1" max="120" value="${ctx.project.fps}"/></label></div><label class="range-occlusion"><input id="range-occlusion" type="checkbox"/>同时检查身体与脸部遮挡（较慢）</label><div class="spatial-toolbar">${button('range-run', '开始检查', 'search', 'primary')}${button('range-cancel', '取消检查', '', 'subtle', 'disabled')}<span id="range-progress" role="status">请选择范围并开始检查。</span></div><label class="range-finding-label">检查结果<select id="range-finding"><option value="">尚未检查</option></select></label><textarea id="range-report" readonly aria-label="区间检查报告"></textarea>`,
            button('range-focus', '跳到此处并定位', '', 'subtle', 'data-range-result disabled') + button('range-text', '导出 TXT', '', 'subtle', 'data-range-result disabled') + button('range-json', '导出 JSON', '', 'subtle', 'data-range-result disabled'));
        $('.modal').classList.add('spatial-modal', 'range-modal');
        $('.range-controls').addEventListener('input', setStale); $('.range-controls').addEventListener('change', setStale);
        $('#range-occlusion').addEventListener('change', setStale);
        $('#range-finding').addEventListener('change', () => { $<HTMLTextAreaElement>('#range-report').value = output(); });
    }
    async function run() {
        let opts: SpatialRangeOptions;
        try {
            if (['range-start', 'range-end', 'range-fps'].some(id => !$('#' + id).value.trim())) throw new Error('请输入完整时间和采样次数');
            opts = { start: Number($('#range-start').value), end: Number($('#range-end').value), sampleFps: Number($('#range-fps').value),
                targetKey: $('#range-target').value, compareKey: $('#range-compare').value || undefined, cameraId: $('#range-camera').value, occlusion: $('#range-occlusion').checked };
        } catch (error) { ctx.toast((error as Error).message, true); return; }
        setStale(); aborter = new AbortController(); ctx.busy = true;
        $('.range-modal').querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input,button,select').forEach(el => el.disabled = true);
        $<HTMLButtonElement>('[data-act="range-cancel"]').disabled = false;
        try {
            report = await scanSpatialRange(ctx.engine, opts, aborter.signal, (done, total) => { $('#range-progress').textContent = `检查中 ${done} / ${total}（${Math.round(done / total * 100)}%）`; });
            stale = false;
            $('#range-finding').innerHTML = options(report.findings.length ? report.findings.map(f => [f.id, `${f.start.toFixed(2)}s · ${f.description}`]) : [['', '此采样范围内未发现待确认情况']], report.findings[0]?.id ?? '');
            $<HTMLTextAreaElement>('#range-report').value = output();
            $('#range-progress').textContent = report.complete ? '检查完成，可定位后修改并重新检查。' : '结果达到上限，请缩小范围重查。';
        } catch (error) {
            $('#range-progress').textContent = (error as Error).name === 'AbortError' ? '已取消，工程和播放位置保持原状。' : (error as Error).message;
        } finally {
            aborter = null; ctx.busy = false;
            $('.range-modal').querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input,button,select').forEach(el => el.disabled = false);
            $<HTMLButtonElement>('[data-act="range-cancel"]').disabled = true;
            document.querySelectorAll<HTMLButtonElement>('[data-range-result]').forEach(b => b.disabled = stale);
            $<HTMLButtonElement>('[data-act="range-focus"]').disabled = stale || !report?.findings.length;
            ctx.updateTimeUI();
        }
    }
    function handle(action: string) {
        if (!action.startsWith('range-')) return false;
        if (action === 'range-open') { open(); return true; }
        if (action === 'range-cancel') { aborter?.abort(); return true; }
        if (action === 'range-run') { void run(); return true; }
        if (stale || !report) return true;
        if (action === 'range-focus') {
            const finding = report.findings.find(f => f.id === $('#range-finding').value);
            if (finding) { ctx.closeModal(); ctx.preview = finding.cameraId; ctx.seek(finding.time); if (finding.targetEntityId) { ctx.selectEntity(finding.targetEntityId); ctx.engine.focus(finding.targetEntityId); } ctx.setView('split'); ctx.renderCameras(); }
        }
        if (action === 'range-text' || action === 'range-json') {
            const json = action === 'range-json'; download(new Blob([json ? JSON.stringify(report, null, 2) : '\uFEFF' + output(true)], { type: json ? 'application/json' : 'text/plain;charset=utf-8' }),
                `${report.projectName}-区间检查-${report.options.start}-${report.options.end}.${json ? 'json' : 'txt'}`);
        }
        return true;
    }
    return { handle };
}
