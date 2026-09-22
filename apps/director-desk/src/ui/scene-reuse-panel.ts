import type { AppContext } from '../app-context.ts';
import { download } from '../storage.ts';
import { safeFilename } from '../production/notes.ts';
import { type Project, type Vec3 } from '../model.ts';
import { readRecoverableProject } from './resource-recovery-panel.ts';
import { mergeScene, type MergeSceneOptions } from '../scenes/merge-project.ts';
import { $, button, escape, options } from './common.ts';
import './scene-reuse-panel.css';

export function createSceneReusePanel(ctx: AppContext) {
    let source: Project | null = null, controller: AbortController | null = null;
    const file = document.createElement('input'); file.type = 'file'; file.accept = '.director,.json'; file.id = 'scene-reuse-file'; file.hidden = true; document.body.append(file);
    function render() {
        const count = source?.entities.length ?? 0;
        ctx.showModal('场景复用', `<div class="scene-reuse-panel"><p class="panel-help">把当前戏段导出为模板，以后可插入其他工程。多戏段文件读取其中保存的当前戏段。模板使用 .director 格式，包含模型资源和参考图。</p><div class="scene-reuse-row">${button('scene-reuse-save', '导出当前场景模板', '', 'subtle')}${button('scene-reuse-choose', source ? '更换场景文件' : '选择场景文件', '', 'subtle')}</div>${source ? `<p class="panel-help scene-reuse-name">${escape(source.name)} · ${count} 个对象 · ${source.duration} 秒 · ${source.resources?.length ?? 0} 项模型资源</p><div class="triple">${['X', 'Y', 'Z'].map((axis, i) => `<label class="field"><span>整体偏移 ${axis} / 米</span><input id="scene-offset-${i}" type="number" step=".1" value="0"/></label>`).join('')}</div><div class="scene-reuse-row"><label class="field"><span>人物与机位调度</span><select id="scene-scheduling">${options([['keep', '保留路径、动作和备注'], ['reset', '保留初始站位，清空调度']], 'keep')}</select></label><label class="field"><span>开始时间 / 秒</span><input id="scene-start" type="number" min="0" step=".1" value="0"/></label></div><label class="field"><span>切镜轨道</span><select id="scene-cuts">${options([['keep', '保持当前切镜，仅加入机位'], ['insert', '用插入场景切镜替换对应区间']], 'keep')}</select></label><p class="panel-help">位置与时间以米、秒迁移。沿用当前画幅和帧率。开始时间不控制对象出现；隐藏墙体会跟随机位迁移。清空调度会移除路径、动作、姿态关键帧及剧情时间备注。</p>` : ''}<p id="scene-reuse-status" class="panel-help" role="status"></p></div>`, button('scene-reuse-cancel', '关闭', '', 'subtle') + (source ? button('scene-reuse-apply', '插入当前工程', '', 'primary') : ''));
        document.querySelector('.modal')?.addEventListener('director-before-close', () => { source = null; }, { once: true });
        document.querySelector('#scene-scheduling')?.addEventListener('change', () => {
            const reset = $('#scene-scheduling').value === 'reset';
            $('#scene-start').disabled = reset; $('#scene-cuts').disabled = reset;
            if (reset) $('#scene-cuts').value = 'keep';
        });
    }
    function busy(value: boolean) {
        ctx.busy = value;
        document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('.scene-reuse-panel button,.scene-reuse-panel input,.scene-reuse-panel select,[data-act="scene-reuse-apply"]').forEach(el => el.disabled = value);
        const cancel = document.querySelector<HTMLButtonElement>('[data-act="scene-reuse-cancel"]'); if (cancel) cancel.textContent = value ? '取消加载' : '关闭';
        if (!value && document.querySelector<HTMLSelectElement>('#scene-scheduling')?.value === 'reset') { $('#scene-start').disabled = true; $('#scene-cuts').disabled = true; }
    }
    file.addEventListener('change', async () => {
        const selected = file.files?.[0]; file.value = ''; if (!selected || ctx.busy || ctx.draft || ctx.history.pending) return;
        const aborter = controller = new AbortController(); busy(true); $('#scene-reuse-status').textContent = '读取场景文件…';
        try {
            const text = await selected.text(); aborter.signal.throwIfAborted(); source = await readRecoverableProject(ctx, JSON.parse(text), aborter.signal, 'template'); render();
        } catch (error) { ctx.toast(aborter.signal.aborted ? '已取消场景读取' : error instanceof Error ? error.message : String(error), !aborter.signal.aborted); }
        finally { controller = null; busy(false); const status = document.querySelector('#scene-reuse-status'); if (status) status.textContent = ''; }
    });
    async function apply() {
        if (!source) return;
        const before = ctx.project, fingerprint = JSON.stringify(before), aborter = controller = new AbortController();
        try {
            const scheduling = $<HTMLSelectElement>('#scene-scheduling').value as MergeSceneOptions['scheduling'];
            const offset = [0, 1, 2].map(i => Number($<HTMLInputElement>(`#scene-offset-${i}`).value)) as Vec3;
            const result = mergeScene(before, source, { offset, scheduling, timeOffset: Number($('#scene-start').value), cuts: $('#scene-cuts').value as MergeSceneOptions['cuts'] });
            busy(true); ctx.playing = false; $('#scene-reuse-status').textContent = '准备模型资源…可取消，完成后一次性插入。';
            await ctx.engine.externalModels.prepare(result.project, aborter.signal); aborter.signal.throwIfAborted();
            if (ctx.project !== before || JSON.stringify(ctx.project) !== fingerprint) throw Error('当前工程已变化，请重新插入');
            busy(false);
            if (ctx.change(() => { ctx.project = result.project; ctx.selected = result.addedIds[0] ?? ctx.selected; })) {
                const added = new Set(result.addedIds), roomFloor = result.project.entities.find(e => added.has(e.id) && e.asset === 'room-part' && e.assetParameters?.part === 0);
                ctx.engine.focus(roomFloor?.id ?? ctx.selected);
                source = null; ctx.closeModal(); ctx.toast(`已插入 ${result.addedIds.length} 个对象，复用 ${result.reusedResources} 项模型资源。${result.warnings.join(' ')}`);
            }
        } catch (error) { ctx.toast(aborter.signal.aborted ? '已取消插入，工程保持原样' : error instanceof Error ? error.message : String(error), !aborter.signal.aborted); }
        finally {
            controller = null; busy(false);
            ctx.engine.externalModels.retain([ctx.project, ...ctx.history.undoStack, ...ctx.history.redoStack]);
            const status = document.querySelector('#scene-reuse-status'); if (status) status.textContent = '';
        }
    }
    return { handle(action: string) {
        if (action === 'scene-reuse-open') { ctx.playing = false; source = null; render(); }
        else if (action === 'scene-reuse-choose') file.click();
        else if (action === 'scene-reuse-save') {
            const scene = ctx.scenes.list().find(s => s.id === ctx.scenes.context.sceneId)!;
            const project = { ...ctx.project, name: scene.name };
            download(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }), safeFilename(scene.name) + '.director');
            ctx.toast('已导出当前戏段模板');
        }
        else if (action === 'scene-reuse-apply') void apply();
        else if (action === 'scene-reuse-cancel') { if (controller) controller.abort(); else { source = null; ctx.closeModal(); } }
        else return false;
        return true;
    } };
}
