import { shortcutReference } from './shortcut-reference.ts';
import { createModalPages } from './modal-pages.ts';
import { SCENE_TEMPLATES } from '../scenes.ts';
import type { Entity } from '../model.ts';
import { $, button, escape, options } from './common.ts';
import type { AppContext } from '../app-context.ts';
import { worldContactAnchors } from '../assets/contact-anchors.ts';
export function createDialogs(ctx: AppContext) {
    const pages = createModalPages(ctx);
    function showModal(title: string, body: string, footer = '') { const template = document.createElement('template'); template.innerHTML = `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-label="${title}"><header class="modal-header"><div><h2>${title}</h2><p>${escape(ctx.project.name)}</p></div>${button('close-modal', '', 'close', 'icon-button', 'aria-label="关闭"')}</header><div class="modal-body">${body}</div>${footer ? `<footer class="modal-footer">${footer}</footer>` : ''}</section></div>`; pages.show(title, template.content.firstElementChild as HTMLElement); const input = $('#modal-root input') as HTMLInputElement | null; input?.focus(); }
    function closeModal() { pages.close(); }
    function projectDialog() { showModal('项目', `<label class="field"><span>项目名称</span><input id="rename-input" value="${escape(ctx.project.name)}" maxlength="80"/></label><p class="panel-help">项目文件可以在其他电脑导入并继续编辑。自动恢复保存在当前浏览器。</p><div class="button-row">${button('scene-reuse-open', '场景复用 / 插入', '', 'subtle')}</div>`, button('resource-open', '工程模型资源', '', 'subtle') + button('resource-statistics', '资源统计', '', 'subtle') + button('rename-project', '保存名称', '', 'primary')); }
    function roomDialog() { showModal('房间尺寸与结构', `<label class="check"><input id="room-enabled" type="checkbox" ${ctx.project.room.enabled ? 'checked' : ''}/>显示房间结构</label><div class="triple">${['width', 'depth', 'height'].map((k, i) => `<label class="field"><span>${['宽度', '进深', '净高'][i]} / 米</span><input id="room-${k}" type="number" min="2.3" step=".1" value="${ctx.project.room[k as 'width']}"/></label>`).join('')}</div><div class="info-box">房间和家具使用真实尺寸。修改房间只改变墙体与地板，家具和人物保持原位置。</div>`, button('close-modal', '取消', '', 'subtle') + button('apply-room', '应用尺寸', '', 'primary')); }
    function deleteDialog(e: Entity) {
        if (e.kind === 'camera') {
            const others = ctx.project.entities.filter(x => x.kind === 'camera' && x.id !== e.id);
            if (!others.length) {
                ctx.toast('至少保留一台摄影机', true);
                return;
            }
            showModal('删除摄影机', `<p class="modal-copy">删除「${escape(e.name)}」，并将使用它的切镜替换为：</p><select id="replacement-camera">${options(others.map(x => [x.id, x.name]), others[0].id)}</select>`, button('close-modal', '取消', '', 'subtle') + button('confirm-delete', '替换并删除', '', 'danger', `data-id="${e.id}"`));
        }
        else
            ctx.deleteEntity(e.id);
    }
    function seatDialog() {
        const furniture = ctx.project.entities.filter(e => e.kind === 'prop' && e.visible).flatMap(e => worldContactAnchors(e, ctx.engine.models.get(e.id)!).filter(a => ['seat', 'bed'].includes(a.role) && a.normal[1] > .98).map((a, i) => ({ id: JSON.stringify([e.id, a.id]), name: `${e.name} · ${a.role === 'bed' ? '床面' : '座位'} ${i + 1} · ${a.position[1].toFixed(2)} 米` })));
        if (!furniture.length) {
            ctx.toast('先添加座椅，或在道具的“接触”面板设置座面');
            return;
        }
        showModal('放到座位', `<label class="field"><span>定位目标</span><select id="seat-target">${options(furniture.map(e => [e.id, e.name]), furniture[0].id)}</select></label><p class="panel-help">按当前帧座面定位并安排全段坐姿。会替换原路径和动作、清除手调姿态；可撤销。此操作不绑定家具，家具移动后需重新定位；可在动作轨道中自行安排其他基础动作。</p>`, button('close-modal', '取消', '', 'subtle') + button('seat-apply', '定位并坐下', '', 'primary'));
    }
    function helpDialog() { showModal('操作与快捷键', shortcutReference(), button('close-modal','完成','','primary')); $('.modal').classList.add('shortcuts-modal'); }
    function sceneDialog() {
        ctx.playing = false;
        showModal('新建工程', '<div class="scene-template-grid">' + SCENE_TEMPLATES.map((t, i) => `<label class="scene-template"><input type="radio" name="scene-template" value="${t.id}" ${i === 0 ? 'checked' : ''}/><span class="template-kind">${t.type}</span><strong>${t.name}</strong><small>${t.detail}</small></label>`).join('') + '</div><p class="panel-help">每个模板都可以继续搭建：到“资产”添加白模，拖到地面摆放；用移动、旋转、缩放和复制调整布局。新建会替换整个工程，可撤销返回。要在当前工程里增加一场，请使用左侧顶部“戏段”。</p>', (ctx.dirty ? button('save-and-new', '保存当前项目后新建', '', 'subtle') : '') + button('confirm-new', '新建工程', '', 'primary'));
        $('.modal').classList.add('template-modal');
    }
    return { sceneDialog, showModal, closeModal, projectDialog, roomDialog, deleteDialog, seatDialog, helpDialog };
}
