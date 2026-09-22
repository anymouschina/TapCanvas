import type { AppContext } from '../app-context.ts';
import { clone } from '../model.ts';
import { applyOperations } from '../automation/edits.ts';
import type { ModelNodeEdit } from '../resources/model-node-edits.ts';
import { boundsBox } from '../spatial/geometry.ts';
import { $, button, escape, options } from './common.ts';
import './resource-panel.css';

export function createModelNodesPanel(ctx: AppContext) {
    let entityId = '', currentPath = '0', parentPath = '0', page = 0, query = '', field = 'offset.0';
    function render() {
        const e = ctx.project.entities.find(e => e.id === entityId); if (!e?.external) return;
        const source = ctx.engine.externalModels.inspection(ctx.project.resources!.find(r => r.id === e.external!.resourceId)!);
        const children = source.nodes.filter(n => query ? [n.path, n.name, e.external!.nodeEdits?.[n.path]?.name, e.external!.nodeEdits?.[n.path]?.category].join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase()) : n.parent === parentPath || n.path === parentPath);
        page = Math.max(0, Math.min(page, Math.ceil(children.length / 12) - 1));
        const slice = children.slice(page * 12, page * 12 + 12);
        if (!slice.some(n => n.path === currentPath)) currentPath = slice[0]?.path ?? '';
        const node = source.nodes.find(n => n.path === currentPath), edit = e.external.nodeEdits?.[currentPath] ?? {};
        const fields: [string, string][] = ['offset', 'rotation', 'scale'].flatMap(k => ['X', 'Y', 'Z'].map((axis, i) => [`${k}.${i}`, `${k === 'offset' ? '整段偏移' : k === 'rotation' ? '自身旋转' : '缩放倍率'} ${axis}${k === 'offset' ? ' / 米' : k === 'rotation' ? ' / 度' : ''}`] as [string, string]));
        const [key, index] = field.split('.'), value = (edit[key as 'offset' | 'rotation' | 'scale']?.[Number(index)] ?? (key === 'scale' ? 1 : 0)) * (key === 'rotation' ? 180 / Math.PI : 1);
        const state = node ? ctx.engine.externalModels.nodes(ctx.project, entityId, { path: node.path, limit: 1 }).nodes[0] : null;
        ctx.showModal('导入模型内部层级', `<div class="resource-panel"><div class="resource-row"><input id="node-query" aria-label="搜索模型节点" placeholder="搜索名称、分类或节点编号" value="${escape(query)}"/>${button('nodes-search', '搜索', '', 'subtle')}</div><div class="resource-row"><select id="node-choice" aria-label="模型内部节点">${options(slice.length ? slice.map(n => [n.path, `${n.path} · ${e.external!.nodeEdits?.[n.path]?.name ?? (n.name || n.kind)}`]) : [['', '没有匹配节点']], currentPath)}</select><span>${page + 1}/${Math.max(1, Math.ceil(children.length / 12))}</span></div><div class="scene-reuse-row">${button('nodes-parent', '上层', '', 'subtle')}${button('nodes-enter', '查看子节点', '', 'subtle', node ? '' : 'disabled')}</div><div class="resource-row"><label class="field"><span>显示名称</span><input id="node-name" maxlength="200" value="${escape(edit.name ?? node?.name ?? '')}" ${node && !e.locked ? '' : 'disabled'}/></label><label class="field"><span>分类</span><input id="node-category" maxlength="200" placeholder="如家具、墙体" value="${escape(edit.category ?? '')}" ${node && !e.locked ? '' : 'disabled'}/></label></div><div class="resource-row"><select id="node-field" aria-label="节点变换参数">${options(fields, field)}</select><input id="node-value" type="number" value="${Number(value.toFixed(6))}" step="${key === 'rotation' ? '5' : '.1'}" ${node?.editable && !e.locked ? '' : 'disabled'}/></div><label class="check"><input id="node-hidden" type="checkbox" ${edit.hidden ? 'checked' : ''} ${node?.editable && !e.locked ? '' : 'disabled'}/>隐藏此节点及其子节点（影响拍摄）</label><p class="panel-help">${state ? `当前世界位置 ${state.origin.map(v => v.toFixed(2)).join(' / ')} 米。${state.offsetLimited ? '当前上层缩放为零，偏移无法生效。' : ''}` : ''} 节点偏移使用模型坐标米，随后再乘对象缩放；旋转叠加在自身轴上。${node?.editable ? '修改叠加在源动画上，不改变源文件。' : '骨架相关节点仅支持名称和分类。'}</p></div>`, button('nodes-prev', '‹', '', 'subtle', page ? '' : 'disabled') + button('nodes-next', '›', '', 'subtle', (page + 1) * 12 < children.length ? '' : 'disabled') + button('nodes-reset', '还原节点', '', 'subtle', node && !e.locked ? '' : 'disabled') + button('nodes-save', '应用节点修改', '', 'primary', node && !e.locked ? '' : 'disabled'));
        $('#node-choice').addEventListener('change', () => { currentPath = $('#node-choice').value; render(); });
        document.querySelector('.modal-footer')?.insertAdjacentHTML('afterbegin', button('nodes-focus', '定位', '', 'subtle', state?.bounds ? '' : 'disabled'));
        $('#node-field').addEventListener('change', () => { field = $('#node-field').value; render(); });
    }
    return { handle(action: string) {
        if (action === 'nodes-open') { entityId = ctx.current()?.id ?? ''; parentPath = currentPath = '0'; page = 0; query = ''; ctx.playing = false; render(); }
        else if (action === 'nodes-search') { query = $('#node-query').value.trim(); page = 0; render(); }
        else if (action === 'nodes-focus') {
            const state = ctx.engine.externalModels.nodes(ctx.project, entityId, { path: currentPath, limit: 1 }).nodes[0];
            if (state?.bounds) { ctx.engine.focusBounds(boundsBox(state.bounds)); ctx.closeModal(); }
        }
        else if (action === 'nodes-prev' || action === 'nodes-next') { page += action === 'nodes-prev' ? -1 : 1; render(); }
        else if (action === 'nodes-enter') { parentPath = currentPath || '0'; query = ''; page = 0; render(); }
        else if (action === 'nodes-parent') { parentPath = parentPath.includes('/') ? parentPath.slice(0, parentPath.lastIndexOf('/')) : '0'; currentPath = parentPath; query = ''; page = 0; render(); }
        else if (action === 'nodes-save' || action === 'nodes-reset') {
            try {
                const e = ctx.project.entities.find(e => e.id === entityId); if (!e?.external || e.locked || !currentPath) return true;
                const external = clone(e.external); external.nodeEdits ??= {};
                if (action === 'nodes-reset') delete external.nodeEdits[currentPath];
                else {
                    const edit: ModelNodeEdit = external.nodeEdits[currentPath] ??= {}; edit.name = $('#node-name').value; edit.category = $('#node-category').value;
                    if (!$('#node-value').disabled) {
                        const [key, index] = field.split('.'), name = key as 'offset' | 'rotation' | 'scale'; edit[name] ??= name === 'scale' ? [1, 1, 1] : [0, 0, 0];
                        edit[name]![Number(index)] = Number($('#node-value').value) * (name === 'rotation' ? Math.PI / 180 : 1); edit.hidden = $('#node-hidden').checked;
                    }
                }
                const next = applyOperations(ctx.project, [{ operation: 'update', id: e.id, patch: { external } }]);
                if (ctx.change(() => { ctx.project = next; })) render();
            } catch (error) { ctx.toast((error as Error).message, true); }
        } else return false;
        return true;
    } };
}
