import type { AppContext } from '../app-context.ts';
import { applyOperations, type EditOperation } from '../automation/edits.ts';
import { resourceUsage } from '../resources/resource-usage.ts';
import { $, button, escape, options } from './common.ts';
import './resource-panel.css';

export function createResourcePanel(ctx: AppContext) {
    let chosen = '', field = 'name';
    const fields: [string, string][] = [['name', '资源名称'], ['license', '许可备注'], ['source', '来源备注'], ['copyright', '版权文本']];
    function render() {
        const list = resourceUsage(ctx.project).map(usage => ({ ...usage, used: ctx.scenes.resourceScenes(usage.id).length > 0 })); if (!list.some(r => r.id === chosen)) chosen = list[0]?.id ?? '';
        const usage = list.find(r => r.id === chosen), resource = ctx.project.resources?.find(r => r.id === chosen);
        const info = resource ? ctx.engine.externalModels.inspection(resource) : null;
        const referenceIds = [...new Set([...(usage?.entityIds ?? []), ...(usage?.motionClips.map(c => c.entityId) ?? [])])];
        const uses = ctx.project.entities.filter(e => referenceIds.includes(e.id));
        const otherScenes = ctx.scenes.resourceScenes(chosen).filter(s => s.id !== ctx.scenes.context.sceneId);
        const note = fields.find(([id]) => id === field)![1];
        ctx.showModal('工程模型资源', `<div class="resource-panel"><p class="panel-help">${list.length} 项源资源 · 源文件合计 ${(list.reduce((sum, r) => sum + r.sourceBytes, 0) / 1048576).toFixed(2)} MiB · ${list.filter(r => !r.used).length} 项未使用。源文件大小不等于显存占用。</p><label class="field"><span>选择资源</span><select id="resource-choice">${options(list.length ? list.map(r => [r.id, `${r.used ? '' : '未使用 · '}${r.name}`]) : [['', '先导入模型资源']], chosen)}</select></label>${resource && usage && info ? `<p class="panel-help">${usage.files} 个源文件 · ${(usage.sourceBytes / 1048576).toFixed(2)} MiB · ${info.meshes} 个网格 · ${Math.ceil(info.triangles).toLocaleString()} 个三角面。当前戏段：${usage.entityIds.length} 个实例，${usage.motionClips.length} 个动作片段。另有 ${otherScenes.length} 场引用。</p><div class="resource-row"><select id="resource-field" aria-label="资源备注类型">${options(fields, field)}</select>${button('resource-save', '保存备注', '', 'subtle')}</div><textarea id="resource-value" aria-label="${note}" maxlength="10000" rows="3">${escape(resource[field as 'name'])}</textarea><div class="resource-row"><select id="resource-entity" aria-label="资源使用对象">${options(uses.length ? uses.map(e => [e.id, e.name]) : [['', '当前场无引用对象']], uses[0]?.id ?? '')}</select>${button('resource-locate', '定位对象', '', 'subtle', uses.length ? '' : 'disabled')}</div><p class="panel-help">清理检查全部戏段的实例与动作引用，撤销历史仍保留恢复所需资源。</p>` : ''}</div>`, button('model-library', '导入资源', '', 'subtle') + button('resource-remove', '移除所选资源', '', 'subtle', usage && !usage.used ? '' : 'disabled') + button('close-modal', '关闭', '', 'primary'));
        $('#resource-choice').addEventListener('change', () => { chosen = $('#resource-choice').value; render(); });
        document.querySelector('#resource-field')?.addEventListener('change', () => { field = $('#resource-field').value; render(); });
    }
    function apply(op: EditOperation) {
        try { const next = applyOperations(ctx.project, [op]); if (ctx.change(() => { ctx.project = next; }, false)) render(); }
        catch (error) { ctx.toast((error as Error).message, true); }
    }
    return { handle(action: string) {
        if (action === 'resource-open') { ctx.playing = false; render(); }
        else if (action === 'resource-save') apply({ operation: 'resource', id: chosen, patch: { [field]: $('#resource-value').value } });
        else if (action === 'resource-remove') apply({ operation: 'resource-remove', id: chosen });
        else if (action === 'resource-locate') { const id = $('#resource-entity').value; if (id) { ctx.closeModal(); ctx.selectEntity(id); ctx.engine.focus(id); } }
        else return false;
        return true;
    } };
}
