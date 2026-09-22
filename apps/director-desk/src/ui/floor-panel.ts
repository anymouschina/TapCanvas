import type { AppContext } from '../app-context.ts';
import { uid } from '../model.ts';
import { assignUnsortedFloors, emptyEditorView, removeFloor } from '../building/floors.ts';
import { escape, options } from './common.ts';
import './native-animation-editor.css';
import './floor-panel.css';

export function createFloorPanel(ctx: AppContext) {
    let floorId = '';
    function render() {
        const floors = ctx.project.floors ?? [], e = ctx.current(), view = ctx.project.editorView ?? emptyEditorView();
        if (!floors.some(f => f.id === floorId)) floorId = view.activeFloorId || floors[0]?.id || '';
        const floor = floors.find(f => f.id === floorId), count = ctx.project.entities.filter(e => e.floorId === floorId).length;
        const choices = floors.map(f => [f.id, `${f.name} · ${f.elevation} m`] as [string, string]);
        ctx.showModal('楼层与布景显示', `<div class="native-editor" id="floor-editor"><div class="native-row"><label>管理楼层<select id="floor-choice">${options(choices.length ? choices : [['', '尚未创建楼层']], floorId)}</select></label><button data-act="floor-new">新建楼层</button></div><div class="native-values"><label>名称<input id="floor-name" maxlength="80" value="${escape(floor?.name ?? '')}" ${floor ? '' : 'disabled'}/></label><label>标高 / 米<input id="floor-elevation" type="number" step=".1" value="${floor?.elevation ?? 0}" ${floor ? '' : 'disabled'}/></label></div><div class="floor-actions"><button data-act="floor-save" ${floor ? '' : 'disabled'}>保存 · ${count} 个对象</button><button data-act="floor-remove" ${floor ? '' : 'disabled'}>删除楼层</button><button data-act="floor-sort" ${floor ? '' : 'disabled'}>未归层按高度分配</button></div><div class="native-row"><label title="${escape(e?.name ?? '')}">选中对象归属<select id="floor-assignment" ${e ? '' : 'disabled'}>${options([['', '未归层'], ...choices], e?.floorId ?? '')}</select></label><button data-act="floor-assign" ${e && !e.locked ? '' : 'disabled'}>应用归属</button></div><div class="floor-actions"><button data-act="floor-work" ${floor ? '' : 'disabled'}>${view.activeFloorId === floorId && floor ? '当前工作层' : '设为工作层'}</button><button data-act="floor-only" ${floor ? '' : 'disabled'}>只看本层</button><button data-act="floor-below" ${floor ? '' : 'disabled'}>隐藏更高楼层</button></div><div class="native-values"><label><input id="floor-hidden" type="checkbox" ${view.hiddenFloorIds.includes(floorId) ? 'checked' : ''} ${floor ? '' : 'disabled'} style="width:auto;height:auto"/>仅布景隐藏本层</label><label><input id="floor-walls" type="checkbox" ${view.hideWalls ? 'checked' : ''} style="width:auto;height:auto"/>仅布景隐藏墙体</label></div><button data-act="floor-hide-object" ${e ? '' : 'disabled'} title="${escape(e?.name ?? '')}">${e && view.hiddenEntityIds.includes(e.id) ? '恢复选中对象的布景显示' : '仅布景隐藏选中对象'}</button><p class="panel-help">标高变化会带动现有成员及其路径，模块连接可能影响其他楼层。归属分配不移动对象；删除楼层保留场景。工作层用于米格、新增白模与无表面时的绘制落点。布景隐藏不影响摄影机、导出和空间检查；未归层对象保持显示。</p></div>`, '<button data-act="floor-reset">恢复全部布景显示</button><button data-act="close-modal">关闭</button>');
        document.querySelector('#floor-editor')!.addEventListener('change', event => {
            const input = event.target as HTMLInputElement;
            if (input.id === 'floor-choice') { floorId = input.value; render(); }
            else if (input.id === 'floor-hidden' || input.id === 'floor-walls') {
                ctx.change(() => { const view = ctx.project.editorView ??= emptyEditorView(); if (input.id === 'floor-walls') view.hideWalls = input.checked;
                    else view.hiddenFloorIds = input.checked ? [...new Set([...view.hiddenFloorIds, floorId])] : view.hiddenFloorIds.filter(id => id !== floorId); }, false); render();
            }
        });
    }
    return { handle(action: string) {
        if (!['floor-open', 'floor-new', 'floor-save', 'floor-remove', 'floor-sort', 'floor-assign', 'floor-work', 'floor-only', 'floor-below', 'floor-hide-object', 'floor-reset'].includes(action)) return false;
        if (action === 'floor-open') { render(); return true; }
        let message = '';
        ctx.change(() => {
            const floors = ctx.project.floors ??= [], floor = floors.find(f => f.id === floorId), e = ctx.current();
            if (action === 'floor-new') { floorId = uid(); floors.push({ id: floorId, name: `楼层 ${floors.length + 1}`, elevation: floors.length ? Math.max(...floors.map(f => f.elevation)) + 3 : 0 }); }
            else if (action === 'floor-save' && floor) { floor.name = (document.querySelector('#floor-name') as HTMLInputElement).value.trim(); floor.elevation = Number((document.querySelector('#floor-elevation') as HTMLInputElement).value); }
            else if (action === 'floor-remove') removeFloor(ctx.project, floorId);
            else if (action === 'floor-sort') message = `已按初始路径位置／摆放高度分配 ${assignUnsortedFloors(ctx.project)} 个未归层对象；锁定对象跳过`;
            else if (action === 'floor-assign' && e) e.floorId = (document.querySelector('#floor-assignment') as HTMLSelectElement).value;
            else {
                const view = ctx.project.editorView ??= emptyEditorView();
                if (action === 'floor-work' && floor) { view.activeFloorId = floorId; view.hiddenFloorIds = view.hiddenFloorIds.filter(id => id !== floorId); }
                else if (action === 'floor-only' && floor) view.hiddenFloorIds = floors.filter(f => f.id !== floorId).map(f => f.id);
                else if (action === 'floor-below' && floor) view.hiddenFloorIds = floors.filter(f => f.elevation > floor.elevation).map(f => f.id);
                else if (action === 'floor-hide-object' && e) view.hiddenEntityIds = view.hiddenEntityIds.includes(e.id) ? view.hiddenEntityIds.filter(id => id !== e.id) : [...view.hiddenEntityIds, e.id];
                else if (action === 'floor-reset') { view.hiddenFloorIds = []; view.hiddenEntityIds = []; view.hideWalls = false; }
            }
        }, false);
        render(); if (message) ctx.toast(message); return true;
    } };
}
