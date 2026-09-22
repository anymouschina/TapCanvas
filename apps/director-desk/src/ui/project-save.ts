import type { AppContext } from '../app-context.ts';
import { download } from '../storage.ts';

export async function saveProjectFile(ctx: AppContext): Promise<boolean> {
    if (ctx.busy || ctx.engine.exporting) { ctx.toast('请先完成或取消当前任务，再保存项目'); return false; }
    if (ctx.draft) ctx.finishPath();
    if (ctx.history.pending || ctx.draft) { ctx.toast('请先结束当前编辑，再保存项目'); return false; }
    const document = ctx.scenes.document(), content = JSON.stringify(document, null, 2);
    const name = document.name.replace(/[<>:"/\\|?*]/g, '_') + '.director';
    ctx.busy = true; ctx.playing = false; ctx.updateTimeUI();
    try {
        const files = window.directorDesktop?.files;
        if (files) {
            const result = await files('save-project', { name, content });
            if (!result.ok) throw Error(result.error || '保存失败');
            if (!result.data?.saved) return false;
        } else {
            download(new Blob([content], { type: 'application/json' }), name);
            ctx.toast('已发起工程下载；浏览器无法确认保存结果，请确认文件后继续。');
            return false;
        }
        ctx.dirty = false;
        documentStatus('项目已保存');
        ctx.toast(`项目已保存，包含全部 ${document.scenes.length} 个独立戏段及共享模型资源`);
        return true;
    } catch (error) { ctx.toast((error as Error).message, true); return false; }
    finally { ctx.busy = false; ctx.updateTimeUI(); }
}
function documentStatus(text: string) { const status = document.querySelector('#save-status'); if (status) status.textContent = text; }
