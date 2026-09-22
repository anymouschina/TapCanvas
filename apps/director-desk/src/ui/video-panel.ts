import { FRAME_RATES, outputSize } from '../model.ts';
import { download } from '../storage.ts';
import { $, button, escape, options } from './common.ts';
import { createExportScenePicker } from './export-scene-picker.ts';
import { estimatedVideoBytes, jobFrames, planVideoExports, type ExportJob, type ExportScene } from '../exporting/plan.ts';
import { runVideoExports } from '../exporting/batch.ts';
import { videoDestination, type SaveMode } from '../exporting/delivery.ts';
import { exportErrorMessage } from '../exporting/errors.ts';
import type { AppContext } from '../app-context.ts';

export function createVideoPanel(ctx: AppContext) {
    let sceneInfo: ExportScene[] = [], picker: ReturnType<typeof createExportScenePicker>;
    let previewKey = '', previousScope = '',previewGeneration=0;
    let previewTask:Promise<void>=Promise.resolve();
    const value = (id: string) => $<HTMLInputElement>(`#export-${id}`).value;
    const batch = () => value('scope') === 'batch';
    async function snapshot() {
        if (ctx.busy) return;
        const at = ctx.time;
        ctx.playing = false; ctx.busy = true; ctx.engine.exporting = true;
        try {
            const [w, h] = outputSize(ctx.project.aspect, 1920);
            await ctx.engine.prepareOutput(at);
            const canvas = ctx.engine.renderOutput(at, w, h, ctx.preview);
            const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
            if (!blob) throw new Error('未能生成截图');
            download(blob, `${ctx.project.name}-${at.toFixed(2)}s.png`);
        } catch (error) { ctx.toast((error as Error).message, true); }
        finally { ctx.busy = false; ctx.engine.restorePreview(at); ctx.updateTimeUI(); }
    }
    function exportDialog() {
        if (ctx.busy) return;
        if (ctx.history.pending || ctx.engine.dragging || ctx.engine.drawingPath) { ctx.toast('请先结束当前编辑操作', true); return; }
        sceneInfo = ctx.scenes.list();
        const current = sceneInfo.find(s => s.id === ctx.scenes.context.sceneId)!;
        previousScope = ''; previewKey = '';
        ctx.showModal('导出参考视频', `<div class="export-layout"><div class="export-fields">
            <label class="field"><span>导出范围</span><select id="export-scope"><option value="single">当前戏段</option><option value="batch">批量戏段 · 独立视频</option></select></label>
            <div id="export-single">
                <label class="field"><span>输出文件名 · 不含扩展名</span><input id="export-name" maxlength="100" value="${escape(current.name)}"/></label>
                <label class="field"><span>输出内容</span><select id="export-camera">${options([['program', '按切镜输出'], ...ctx.project.entities.filter(e => e.kind === 'camera').map(e => [e.id, e.name] as [string, string])], ctx.preview)}</select></label>
                <div class="range-shortcuts"><button data-range="all">整场</button><button data-range="15">从此处起 15 秒</button><button data-range="30">30 秒</button></div>
                <div class="field-pair"><label class="field"><span>开始 / 秒</span><input id="export-start" type="number" min="0" step=".1" value="0"/></label><label class="field"><span>结束 / 秒</span><input id="export-end" type="number" step=".1" value="${ctx.project.duration}"/></label></div>
            </div>
            <div id="export-batch" hidden><p class="panel-help">每场沿用画幅、完整时长和切镜。勾选戏段，编辑输出文件名。</p><div id="export-scene-picker"></div></div>
            <div class="export-settings field-pair">
                <label class="field"><span>分辨率</span><select id="export-size">${options([['1920', '1080p 级'], ['1280', '720p 级'], ['640', '360p 级']], '1920')}</select></label>
                <label class="field"><span>帧率</span><select id="export-fps">${options([['scene', '沿用各戏段'], ...FRAME_RATES.map(f => [String(f), f + ' fps'] as [string, string])], 'scene')}</select></label>
                <label class="field"><span>视频格式</span><select id="export-format"><option value="mp4">MP4 / H.264</option><option value="webm">WebM / VP9</option></select></label>
                <label class="field"><span>白模外观</span><select id="export-color"><option value="color">角色区分色</option><option value="white">统一白模色</option></select></label>
            </div>
            <label class="field"><span>保存方式</span><select id="export-save"></select></label><p id="export-save-help" class="panel-help"></p>
        </div><div class="export-preview"><div class="section-label">当前戏段预览<span>${ctx.time.toFixed(2)} s</span></div>
            <img src="${ctx.engine.shotRenderer.domElement.toDataURL('image/png')}" alt="当前摄影机真实取景"/>
            <div id="export-summary" class="export-summary" aria-live="polite"></div>
            <p>重命名仅影响输出文件。网格、路径和控制点不会进入视频。</p>
            <div id="export-progress" hidden><div class="progress-top"><strong id="progress-title">正在生成视频</strong><span id="progress-percent">0%</span></div><progress value="0" max="1"></progress><p id="progress-detail">准备导出</p></div>
        </div></div>`, button('close-modal', '取消', '', 'subtle') + button('export-start', '导出视频', 'download', 'primary'));
        $('.modal').classList.add('export-modal');
        picker = createExportScenePicker(sceneInfo, current.id, updateExportSummary);
        picker.mount($('#export-scene-picker'));
        updateExportSummary();
    }
    function exportPlan() {
        return planVideoExports(sceneInfo, batch() ? picker.selections() : [{ sceneId: ctx.scenes.context.sceneId, filename: value('name') }],
            { size: Number(value('size')), fps: value('fps') === 'scene' ? 'scene' : Number(value('fps')),
                format: value('format') as 'mp4' | 'webm', monochrome: value('color') === 'white' },
            batch() ? undefined : { start: Number(value('start')), end: Number(value('end')), cameraId: value('camera') });
    }
    function updateExportSummary() {
        if (!$('#export-summary') || ctx.busy) return;
        const isBatch = batch(), scope = value('scope');
        $('#export-single').hidden = isBatch; $('#export-batch').hidden = !isBatch;
        if (scope !== previousScope) {
            if (isBatch) picker.refresh();
            else if (previousScope === 'batch') $('#export-name').value = picker.name(ctx.scenes.context.sceneId);
            const save = $('#export-save'), old = save.value;
            const choices: [string, string][] = [];
            if (window.directorDesktop?.files) choices.push(['default', window.directorDesktop.exportLabel || '默认导出目录 · 自动保存']);
            if (isBatch && 'showDirectoryPicker' in window) choices.push(['directory', '选择文件夹 · 直接写入']);
            if (!isBatch && 'showSaveFilePicker' in window) choices.push(['disk', '选择文件 · 直接写入']);
            choices.push(['download', '下载视频']);
            save.innerHTML = options(choices, choices.some(([id]) => id === old) ? old : choices[0][0]);
            previousScope = scope;
        }
        if (!isBatch) picker.rename(ctx.scenes.context.sceneId, value('name'));
        $('#export-save-help').textContent = value('save') === 'default' ? (window.directorDesktop?.exportHelp || '保存到设置中的默认导出目录；重名自动编号。')
            : value('save') === 'download' && isBatch ? '浏览器可能询问是否允许下载多个文件，请允许。' : '逐个生成；取消时已完成的视频会保留。';
        const start = $<HTMLButtonElement>('[data-act="export-start"]');
        let jobs: ExportJob[];
        try {
            jobs = exportPlan(); start.disabled = false;
            start.textContent = isBatch ? `导出 ${jobs.length} 场视频` : '导出视频';
            const duration = jobs.reduce((sum, job) => sum + job.options.end - job.options.start, 0);
            $('#export-summary').innerHTML = `<strong>${jobs.length} 个视频 · 共 ${duration.toFixed(2)} 秒</strong><span>${jobs.reduce((sum, job) => sum + jobFrames(job), 0)} 帧 · ${value('format').toUpperCase()}</span>`
                + (isBatch ? '<span>画幅与切镜沿用各戏段；同名自动编号。</span>' : `<span>${jobs[0].options.width} × ${jobs[0].options.height} · ${jobs[0].options.fps} fps</span><span class="export-filename">${escape(jobs[0].filename)}</span>`);
        } catch (error) { start.disabled = true; $('#export-summary').textContent = (error as Error).message; return; }
        // Filename edits, paging and output format changes do not need another 3D render.
        const o = isBatch ? { ...jobs[0].options, start: 0, end: ctx.project.duration, fps: ctx.project.fps, cameraId: ctx.preview } : jobs[0].options;
        const sampleTime = Math.max(o.start, Math.min(ctx.time, o.end - 1 / o.fps));
        const key = JSON.stringify([sampleTime, o.monochrome, o.cameraId]);
        if (key === previewKey) return;
        const generation=++previewGeneration;
        previewTask=previewTask.then(async()=>{
            if(generation!==previewGeneration||ctx.busy||!document.querySelector('.export-preview img'))return;
            const oldTime=ctx.time,oldMono=ctx.engine.monochrome;
            const [width,height]=outputSize(ctx.project.aspect,640);ctx.engine.exporting=true;
            try{
                ctx.engine.monochrome=o.monochrome;await ctx.engine.prepareOutput(sampleTime);
                if(generation!==previewGeneration||!document.querySelector('.export-preview img'))return;
                const canvas=ctx.engine.renderOutput(sampleTime,width,height,o.cameraId);
                $<HTMLImageElement>('.export-preview img').src=canvas.toDataURL('image/png');
                $('.export-preview .section-label').innerHTML=`当前戏段 · ${escape(ctx.engine.cameraEntity(o.cameraId).name)}<span>${sampleTime.toFixed(2)} s</span>`;previewKey=key;
            }catch(error){if(generation===previewGeneration)ctx.toast((error as Error).message,true);}
            finally{ctx.engine.monochrome=oldMono;ctx.engine.restorePreview(oldTime);}
        });
    }
    async function startExport() {
        if (ctx.busy) return;
        let jobs: ExportJob[];
        try { jobs = exportPlan(); }
        catch (error) { ctx.toast((error as Error).message, true); return; }
        const mode = value('save') as SaveMode;
        if (['default', 'download'].includes(mode)) {
            const large = jobs.find(job => estimatedVideoBytes(job) > 250000000);
            if (large) { ctx.toast(`“${large.sceneName}”预计超过 250 MB，请选择直接写入或降低规格`, true); return; }
        }
        ctx.busy = true; ctx.playing = false; ctx.updateTimeUI();
        ++previewGeneration;
        ctx.aborter = new AbortController();
        let started = false, succeeded = false, count = 0;
        try {
            // Open the picker while the export click still has user activation.
            const destination = await videoDestination(mode, jobs);
            await previewTask;
            started = true;
            $('#export-progress').hidden = false;
            document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('.export-fields input,.export-fields select,.export-fields button').forEach(el => el.disabled = true);
            $('.modal-footer').innerHTML = button('cancel-export', '取消导出', '', 'subtle');
            const { exportVideo } = await import('../export.ts');
            await runVideoExports(ctx.engine, jobs, id => ctx.scenes.projectFor(id), destination, ctx.aborter.signal,
                (job, index, p) => {
                    $<HTMLProgressElement>('#export-progress progress').value = p;
                    $('#progress-percent').textContent = Math.round(p * 100) + '%';
                    $('#progress-title').textContent = `正在导出 ${index + 1} / ${jobs.length} 场`;
                    $('#progress-detail').textContent = `${job.sceneName} → ${job.filename} · 已完成 ${count} 场`;
                }, (_job, filename) => { count++; $('#progress-detail').textContent = `已完成 ${count} / ${jobs.length}：${filename}`; }, exportVideo);
            ctx.toast(mode === 'download' ? `已生成 ${count} 个视频，请在下载列表查看` : `已导出 ${count} 个视频`);
            succeeded = true;
        } catch (error) {
            const canceled = (error as Error).name === 'AbortError';
            if (started) ctx.toast(`${canceled ? '已取消导出' : exportErrorMessage(error)}；已完成 ${count} / ${jobs.length}，其余未完成`, !canceled);
            else if (!canceled) ctx.toast(exportErrorMessage(error), true);
        } finally {
            ctx.busy = false; ctx.aborter = null;
            if (succeeded) ctx.closeModal();
            else if (document.querySelector('.export-modal')) {
                $('#export-progress').hidden = true;
                document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('.export-fields input,.export-fields select,.export-fields button').forEach(el => el.disabled = false);
                picker.refresh();
                $('.modal-footer').innerHTML = button('close-modal', '返回', '', 'subtle') + button('export-start', count ? '重新导出所选戏段' : '重试导出', 'download', 'primary');
            }
            ctx.renderPanels();
        }
    }
    return { snapshot, exportDialog, updateExportSummary, startExport };
}
