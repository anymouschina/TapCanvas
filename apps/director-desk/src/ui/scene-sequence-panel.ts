import type { AppContext } from '../app-context.ts';
import { addDocumentScene, duplicateDocumentScene, removeDocumentScene, renameDocumentScene, reorderDocumentScenes, type SceneDocument } from '../scenes/sequence-project.ts';
import { createScene, SCENE_TEMPLATES, type SceneTemplate } from '../scenes.ts';
import { $, button, escape, options } from './common.ts';
import './scene-sequence-panel.css';
import { continueScene, continuitySummary } from '../scenes/continue-scene.ts';

export function renderSceneSwitcher(ctx: AppContext) {
    const select = $<HTMLSelectElement>('#scene-switch');
    const entries = ctx.scenes.list(), id = ctx.scenes.context.sceneId;
    const markup = options(entries.map((scene, index) => [scene.id, `${index + 1}. ${scene.name}`]), id);
    if (select.innerHTML !== markup) select.innerHTML = markup;
    select.value = id;
}
export function createSceneSequencePanel(ctx: AppContext) {
    async function inherit() {
        const context = ctx.scenes.context, document = ctx.scenes.document(), name = $<HTMLInputElement>('#sequence-new-name').value.trim();
        ctx.busy = true; ctx.playing = false;
        try {
            const next = await continueScene(ctx.engine, document, name);
            ctx.applyDocument(next, context, '从末帧接拍'); ctx.busy = false; ctx.closeModal();
            ctx.toast('已从上一场实际输出末帧接拍；添加新动作后继续表演');
        } catch (error) { ctx.toast((error as Error).message, true); }
        finally { ctx.busy = false; ctx.updateTimeUI(); }
    }
    async function showOrigin() {
        const data = await continuitySummary(ctx.scenes.document());
        ctx.showModal('接拍前情与站位', `<p class="panel-help">保存于接拍时的来源末帧。位置为米，朝向为世界方向向量；群演逐人列出。来源后续修改或删除不会改写这里。</p><textarea readonly rows="14" aria-label="接拍来源记录">${escape(JSON.stringify(data, null, 2))}</textarea>`);
        $('.modal').classList.add('origin-modal');
    }
    const apply = (label: string, operation: (document: SceneDocument) => SceneDocument) => {
        if (ctx.busy || ctx.draft || ctx.history.pending) { ctx.toast('请先完成当前编辑或任务'); renderSceneSwitcher(ctx); return false; }
        try {
            const context = ctx.scenes.context;
            ctx.applyDocument(operation(ctx.scenes.document()), context, label); return true;
        } catch (error) { ctx.toast((error as Error).message, true); renderSceneSwitcher(ctx); return false; }
    };
    $<HTMLSelectElement>('#scene-switch').addEventListener('change', event => {
        const id = (event.target as HTMLSelectElement).value;
        if (id === ctx.scenes.context.sceneId) return;
        try {
            if (ctx.busy) throw Error('请先完成当前编辑或任务');
            ctx.switchScene(id, ctx.scenes.context); ctx.toast('已切换到 ' + ctx.scenes.list().find(s => s.id === id)!.name);
        } catch (error) { ctx.toast((error as Error).message, true); renderSceneSwitcher(ctx); }
    });
    function open() {
        const scenes = ctx.scenes.list(), id = ctx.scenes.context.sceneId, index = scenes.findIndex(s => s.id === id), scene = scenes[index];
        ctx.showModal('独立戏段', `<div class="sequence-panel"><p class="panel-help">当前第 ${index + 1} 场，共 ${scenes.length} 场。各场站位、路径、动作、切镜及备注独立保存；顶部戏段下拉框随时切换。</p>
            <label class="field">当前戏段名称<input id="sequence-name" maxlength="200" value="${escape(scene.name)}"/></label>
            <div class="sequence-actions">${button('sequence-rename', '保存名称', '', 'subtle')}${button('sequence-up', '上移', '', 'subtle', index === 0 ? 'disabled' : '')}${button('sequence-down', '下移', '', 'subtle', index === scenes.length - 1 ? 'disabled' : '')}${button('sequence-delete', '删除本场', '', 'subtle', scenes.length === 1 ? 'disabled' : '')}</div>
            <label class="field">新增戏段名称<input id="sequence-new-name" maxlength="200" value="第 ${scenes.length + 1} 场"/></label>
            <label class="field">新场景模板<select id="sequence-template">${options(SCENE_TEMPLATES.map(t => [t.id, t.name]), 'blank')}</select></label>
            <div class="sequence-actions">${button('sequence-add', '按模板新增', '', 'subtle')}${button('sequence-copy', '完整复制', '', 'subtle')}${button('sequence-inherit', '从末帧接拍', '', 'primary')}</div>
            <p class="panel-help">接拍继承实际末帧并清空新场调度，初始姿态保持到新动作开始。完整复制则保留原时间轴。修改体型或模型结构后使用新模型默认姿态。</p></div>`, button('sequence-origin', '查看接拍前情', '', 'subtle') + button('close-modal', '关闭', '', 'subtle'));
    }
    return { handle(action: string) {
        if (!action.startsWith('sequence-')) return false;
        if (action === 'sequence-open') { open(); return true; }
        if (action === 'sequence-inherit') { void inherit(); return true; }
        if (action === 'sequence-origin') { void showOrigin().catch(error => ctx.toast(error.message, true)); return true; }
        const id = ctx.scenes.context.sceneId;
        if (action === 'sequence-delete') {
            const name = ctx.scenes.list().find(s => s.id === id)!.name;
            ctx.showModal('删除戏段', `<p class="modal-copy">删除「${escape(name)}」的全部调度和备注？可以撤销恢复。</p>`, button('sequence-confirm-delete', '删除本场', '', 'primary'));
            return true;
        }
        let changed = false;
        if (action === 'sequence-confirm-delete') changed = apply('删除戏段', doc => removeDocumentScene(doc, id));
        if (action === 'sequence-rename') changed = apply('重命名戏段', doc => renameDocumentScene(doc, id, $<HTMLInputElement>('#sequence-name').value.trim()));
        if (action === 'sequence-copy') changed = apply('复制戏段', doc => duplicateDocumentScene(doc, id, $<HTMLInputElement>('#sequence-new-name').value.trim()));
        if (action === 'sequence-add') changed = apply('新增戏段', doc => addDocumentScene(doc, createScene($<HTMLSelectElement>('#sequence-template').value as SceneTemplate), $<HTMLInputElement>('#sequence-new-name').value.trim()));
        if (action === 'sequence-up' || action === 'sequence-down') changed = apply('排序戏段', doc => {
            const ids = doc.scenes.map(s => s.id), index = ids.indexOf(id), target = index + (action === 'sequence-up' ? -1 : 1);
            if (target < 0 || target >= ids.length) return doc;
            [ids[index], ids[target]] = [ids[target], ids[index]]; return reorderDocumentScenes(doc, ids);
        });
        if (changed) { ctx.closeModal(); ctx.toast('已更新戏段，可撤销'); }
        return true;
    } };
}
