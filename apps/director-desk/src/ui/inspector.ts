import { createSceneProperties } from './scene-properties.ts';
import { bindActionPicker } from './action-picker.ts';
import { createColorPalette } from './color-palette.ts';
import {SURFACE_VISUALS} from '../visuals/model.ts';
import { inspectorTabs, inspectorCategories } from './inspector-tabs.ts';
import { createVisualPanel } from './visual-panel.ts';
import { createSurfacePanel } from './surface-panel.ts';
import { inheritedPoseAt, poseLayout } from '../scenes/initial-pose.ts';
import { parameterDefaults } from '../parametric-props.ts';
import { structurePorts } from '../building/structure-ports.ts';
import { findAsset, isAnimalAsset } from '../asset-catalog.ts';
import type { Entity } from '../model.ts';
import { ACTIONS } from '../model.ts';
import { $, button, escape, field, num, select } from './common.ts';
import type { AppContext } from '../app-context.ts';
import { createAssetParameterEditor } from './asset-parameter-editor.ts';
import { createExternalParameterEditor } from './external-parameter-editor.ts';
import { createNativeAnimationEditor } from './native-animation-editor.ts';
import { createRigEditor } from './rig-editor.ts';
import { createRetargetAnimationEditor } from './retarget-animation-editor.ts';
import { createContactAnchorEditor } from './contact-anchor-editor.ts';
import { createHandBindingEditor } from './hand-binding-editor.ts';
import { createInspectorNavigation } from './inspector-navigation.ts';
import { createPathInspector } from './inspector-path.ts';
import { createActionInspector } from './inspector-actions.ts';
import { cameraInspector } from './inspector-camera.ts';
import { createPoseInspector } from './inspector-pose.ts';
import { transformInspector } from './inspector-transform.ts';
import { createLegacyParameterEditor } from './legacy-parameter-editor.ts';
import { createLightingPanel } from './lighting-panel.ts';
import { createCameraEffectsPanel } from './camera-effects-panel.ts';
import { createTimelineCurves } from './timeline-curves.ts';
import { createAIEditLocations } from './ai-edit-locations.ts';
export function createInspector(ctx: AppContext) {
    const sceneProperties = createSceneProperties(ctx);
    let selectionTab = 'base';
    $('#inspector-scope').addEventListener('click', event => {
        const scope = (event.target as HTMLElement).closest<HTMLElement>('[data-inspector-scope]')?.dataset.inspectorScope;
        if (!scope) return; event.stopPropagation();
        if (scope === 'scene') { if (ctx.inspectorTab !== 'environment') selectionTab = ctx.inspectorTab; ctx.inspectorTab = 'environment'; }
        else if (ctx.inspectorTab === 'environment') ctx.inspectorTab = selectionTab === 'ai-changes' ? 'base' : selectionTab;
        renderInspector();
    });
    const colorPalette = createColorPalette(ctx);
    const surfaces=createSurfacePanel(ctx),visuals=createVisualPanel(ctx);
    const lightingEditor = createLightingPanel(ctx), cameraEffects = createCameraEffectsPanel(ctx);
    const timelineCurves = createTimelineCurves(ctx), editLocations = createAIEditLocations(ctx);
    const navigation = createInspectorNavigation();
    $('#inspector-header').addEventListener('click', event => {
        if (!(event.target as HTMLElement).closest('[data-inspector-origin]')) return;
        event.stopPropagation(); ctx.inspectorTab = 'base'; navigation.select(`${ctx.selected}:base`, 'initial'); renderInspector();
    });
    const legacyEditor = createLegacyParameterEditor();
    const pathEditor = createPathInspector(ctx, navigation, renderInspector);
    const actionEditor = createActionInspector(navigation, renderInspector);
    const poseEditor = createPoseInspector(ctx, navigation, renderInspector);
    const parameterEditor = createAssetParameterEditor(ctx);
    const externalEditor = createExternalParameterEditor(ctx, renderInspector);
    const nativeEditor = createNativeAnimationEditor(ctx, renderInspector);
    const rigEditor = createRigEditor(ctx, renderInspector);
    const retargetEditor = createRetargetAnimationEditor(ctx, renderInspector);
    const contactEditor = createContactAnchorEditor(ctx, renderInspector);
    const handEditor = createHandBindingEditor(ctx, renderInspector);
    const transformFields = (e: Entity) => transformInspector(ctx, e);
    let disposeActionPicker = () => {};
    let rendering = false, renderPending = false, lastPartRequest = '';
    function renderInspector() {
        // Replacing a focused input can fire its native change event. Its commit
        // requests a refresh, which must wait until this DOM replacement finishes.
        if (rendering) { renderPending = true; return; }
        rendering = true;
        try {
            renderContent();
            navigation.reveal();
            timelineCurves.refresh();
        }
        finally {
            rendering = false;
            if (renderPending) { renderPending = false; queueMicrotask(renderInspector); }
        }
    }
    function renderContent() {
        disposeActionPicker();
        document.querySelectorAll<HTMLElement>('[data-inspector-scope]').forEach(button=>button.setAttribute('aria-pressed',String((button.dataset.inspectorScope==='scene')===(ctx.inspectorTab==='environment'))));
        const e = ctx.current();
        if (ctx.inspectorTab === 'curves') {
            timelineCurves.open();
            ctx.inspectorTab = e?.light ? 'light' : e?.camera ? 'camera' : 'base';
        }
        if (!e || ctx.inspectorTab !== 'contacts' || e.kind !== 'prop') ctx.engine.showContactAnchor();
        if (ctx.inspectorTab === 'ai-changes') {
            $('#inspector-header').innerHTML = '<div class="inspect-title"><h2>AI 修改定位</h2></div><div class="inspect-subtitle">内置助手与 MCP · 点击记录定位</div>';
            $('#inspector-tabs').innerHTML = '';
            $('#inspector-content').innerHTML = editLocations.render(); editLocations.bind();
            $('#inspector-footer').innerHTML = '<div class="page-footer">'+button('inspector-return', '返回', '', 'subtle')+'</div>'; return;
        }
        if (ctx.inspectorTab === 'environment') {
            $('#inspector-header').innerHTML = '<div class="inspect-title"><h2>灯光与场景</h2></div><div class="inspect-subtitle">调整直接作用于当前戏段</div>';
            $('#inspector-tabs').innerHTML = '';
            $('#inspector-content').innerHTML = sceneProperties.render() + lightingEditor.render(); lightingEditor.bind();
            $('#inspector-footer').innerHTML = `<div class="inspector-tool-actions">${lightingEditor.footer()}</div>`;
            return;
        }
        if (!e) {
            $('#inspector-header').innerHTML = '<div class="inspect-title">场景设置</div>';
            $('#inspector-tabs').innerHTML = '';
            $('#inspector-content').innerHTML = '<div class="empty-state">在布景或左侧列表中<br>选择一个对象开始编辑。</div>';
            $('#inspector-footer').innerHTML = '';
            return;
        }
        const definition = findAsset(e.asset), external = e.external;
        const modelInfo = external ? ctx.engine.externalModels.inspection(ctx.project.resources!.find(r => r.id === external.resourceId)!) : null;
        const hasBones = !!modelInfo?.bones.length, hasAnimations = modelInfo?.animations.some(a => a.duration > 0 && a.tracks > 0);
        const animal = isAnimalAsset(e.asset);
        const supportedActions = Object.entries(ACTIONS).filter(([key]) => !definition?.capabilities || definition.capabilities.actions.includes(key as keyof typeof ACTIONS));
        const colorButton = `<button data-act="color-open" class="model-color-button subtle" title="打开色板调色" ${e.locked ? 'disabled' : ''}><i class="model-color-chip" style="background:${e.color}"></i>调色</button>`;
        $('#inspector-header').innerHTML = `<div class="inspect-title"><h2>${escape(e.name)}</h2><span class="type-badge">${e.light ? '灯光' : { actor: animal ? '动物' : '人物', camera: '摄影机', prop: '道具', crowd: '群演' }[e.kind]}</span>${colorButton}</div><div class="inspect-subtitle">${external ? `导入模型 · ${e.clips.some(c => c.retarget || c.action !== 'idle' && c.action !== 'native') ? '预设动作与路径调度' : hasAnimations ? '自带动画与路径调度' : '静态姿态与路径调度'}` : animal ? `动物白模 · 总高 ${e.height.toFixed(2)} m · 姿态可调` : e.kind === 'actor' ? `${e.gender === 'male' ? '男' : '女'} · 身高 ${e.height.toFixed(2)} m · 关节可调` : e.kind === 'camera' ? '同场景真实取景' : e.light ? '同场景真实照明' : '可编辑的三维白模'}</div>`;
        colorPalette.render();
        const initialStatus = e.initialPose?.layout !== poseLayout(e) ? '模型已调整，继承姿态不再应用' : inheritedPoseAt(e, ctx.time) ? '当前保持接拍姿态' : '新动作接管，保留开头姿态';
        if (e.initialPose) $('#inspector-header .inspect-subtitle').innerHTML = `<button class="initial-pose-link" data-inspector-origin title="${initialStatus}">接拍姿态 · 查看详情</button>`;
        if (e.locked) $('#inspector-header .inspect-title').insertAdjacentHTML('beforeend', button('unlock-selected', '解锁', '', 'inspector-unlock subtle', 'title="当前对象已锁定，仅可查看；点击解锁"'));
        const tabs = external ? [['base', '基础'], ['structure', '模型'], ...(hasBones ? [['rig', '骨架']] : []), ...(hasAnimations ? [['actions', '动画']] : []), ['path', '路径']] : e.kind === 'camera' ? [['base', '基础'], ['camera', '摄影机'], ['path', '路径']] : e.kind === 'prop' ? [['base', '基础'], ...(parameterDefaults[e.asset] || definition?.parameters ? [['structure','结构']] : []), ['path', '路径']] : [['base', '基础'], ...(definition?.parameters ? [['structure', '外形']] : []), ['actions', '动作'], ['path', '路径'], ['pose', '姿态']];
        if (!animal && ((external && e.kind === 'actor' && hasBones) || (!external && ['actor', 'crowd'].includes(e.kind)))) tabs.splice(tabs.findIndex(([key]) => key === 'path'), 0, ['retarget', '素材']);
        if (e.kind === 'prop' && !e.light && !e.visual && !e.field && !e.warp) tabs.splice(tabs.findIndex(([key]) => key === 'path'), 0, ['hand', '手持'], ['contacts', '接触']);
        if (e.light) tabs.splice(0, tabs.length, ['light', '灯光'], ['base', '变换'], ['path', '路径']);
        if (e.camera) tabs.splice(2, 0, ['effects', '运镜效果']);
        if(e.asset==='light-spot')tabs.push(['surface','投影']);
        if(e.kind!=='camera'&&!e.light&&!e.field&&!e.warp&&(!e.visual||SURFACE_VISUALS.has(e.visual.preset)))tabs.push(['surface','材质'],['deform','形变']);
        if(e.visual||e.field||e.warp)tabs.push(['visual',e.field?'影响':e.warp?'扭曲':'元素']);
        if (!tabs.some(([k]) => k === ctx.inspectorTab))
            ctx.inspectorTab = tabs[0][0];
        const groups = inspectorCategories(tabs), category = groups.find(group=>group.members.includes(ctx.inspectorTab))!;
        $('#inspector-tabs').innerHTML = inspectorTabs(groups, ctx.inspectorTab);
        const renderPart = (part: string) => {
        let html = '';
        if (part === 'base') {
            html = '<div class="object-identity">' + field('名称', 'name', e.name, 'type="text" maxlength="80"') + select('编辑状态', 'locked', [['false', '可编辑'], ['true', '锁定']], String(e.locked)) + '</div>';
            html += transformFields(e);
            if (!external && e.kind === 'actor')
                html += `<div class="field-pair">${num(animal ? '总高 / 米' : '身高 / 米', 'height', e.height, '.01', animal ? 'min=".03" max="10"' : 'min=".2" max="10"')}${select('体型', 'build', [['slim', '偏瘦'], ['normal', '标准'], ['broad', '健壮']], e.build)}</div>`;
            if (e.kind !== 'camera' && !e.handBinding && !['ground', 'road'].includes(e.asset)) html += button('ground-selected', '最低点对齐地面', '', 'wide subtle', 'title="整条路径随对象一起平移"');
            const sections = [{ id: 'transform', label: '对象与变换', html: '<div class="object-properties">' + html + '</div>' }];
            if (e.kind === 'crowd') sections.push({ id: 'crowd', label: '群演', html: `<div class="field-pair">${num('身高 / 米', 'height', e.height, '.01', 'min=".2" max="10"')}${select('体型', 'build', [['slim', '偏瘦'], ['normal', '标准'], ['broad', '健壮']], e.build)}</div><div class="field-pair">${num('人数', 'count', e.count, '1', 'min="1" max="1000"')}${num('间距 / 米', 'spacing', e.spacing, '.1', 'min=".2"')}</div>${num('分布种子', 'seed', e.seed, '1')}` });
            if (e.kind === 'actor' && !animal && !external || e.reference) {
                const ref = ctx.project.references.find(r => r.id === e.reference);
                sections.push({ id: 'placement', label: '辅助', html: (e.kind === 'actor' && !animal && !external ? button('seat', '放到座面', '', 'wide subtle') : '')
                    + (ref ? `<div class="reference-inline"><img src="${ref.data}" alt="${escape(ref.name)}"/><span>${escape(ref.name)}</span></div>` : '') });
            }
            if (e.initialPose) sections.push({ id: 'initial', label: '接拍', html: `<p class="panel-help">${initialStatus}。</p><p class="panel-help">添加新动作后继续表演。清除后使用当前动作或默认姿态，不改变上一场。</p>` + button('initial-pose-clear', '清除本场继承姿态', '', 'wide subtle', e.locked ? 'disabled' : '') });
            html = navigation.render(`${e.id}:base`, sections);
        }
        else if (part === 'retarget') html = retargetEditor.render(e);
        else if (part === 'contacts') html = contactEditor.render(e);
        else if (part === 'hand') html = handEditor.render(e);
        else if (part === 'rig' && external) html = rigEditor.render(e);
        else if (part === 'structure') {
            if (external) {
                html += externalEditor.render(e);
                html += button('nodes-open', '内部节点 / 层级整理', '', 'wide subtle');
            }
            if (definition?.parameters) html += parameterEditor.render(e, definition);
            if (parameterDefaults[e.asset]) html += legacyEditor.render(e);
            if (structurePorts(e).length) html += `<div class="button-row">${button('adjoin-prop','接一段','plus','subtle')}${button('link-open',e.structureLink ? '编辑模块连接' : '连接其他模块','','subtle')}</div>`;
        }
        else if (part === 'path') html = pathEditor.render(e, !animal && !external && ['actor', 'crowd'].includes(e.kind));
        else if (part === 'actions') html = external ? nativeEditor.render(e) : actionEditor.render(e, supportedActions, animal);
        else if (part === 'pose') html = poseEditor.render(e) + button('pose-key', '记录当前姿态', 'plus', 'wide subtle');
        else if (part === 'camera') html = cameraInspector(ctx, e, navigation);
        else if (part === 'light') html = lightingEditor.render(e);
        else if (part === 'effects' && e.camera) html = cameraEffects.render(e);
        else if (part === 'visual'||part==='deform') html=visuals.render(e, part === 'deform');
        else if (part === 'surface') html = surfaces.render(e);
        if (part === 'effects') html += '<div class="inspector-tool-actions">' + cameraEffects.footer() + '</div>';
        if (part === 'light') html += '<div class="inspector-tool-actions">' + lightingEditor.footer() + '</div>';
        return html;
        };
        const html = category.members.map(part=>`<section data-inspector-part="${part}" class="inspector-category-part">${['base','camera','path','actions','pose'].includes(part)?'':`<h2>${escape(tabs.find(([key])=>key===part)![1])}</h2>`}${renderPart(part)}</section>`).join('');
        $('#inspector-content').innerHTML = html;
        disposeActionPicker = bindActionPicker();
        const request = e.id + ':' + ctx.inspectorTab;
        if (lastPartRequest !== request && ctx.inspectorTab !== category.members[0]) {
            const target=ctx.inspectorTab; queueMicrotask(()=>document.querySelector<HTMLElement>(`[data-inspector-part="${CSS.escape(target)}"]`)?.scrollIntoView({block:'start'}));
        }
        lastPartRequest=request;
        if (category.members.includes('light')) lightingEditor.bind();
        if (category.members.includes('effects')) cameraEffects.bind();
        $('#inspector-footer').innerHTML = ctx.draft ? `<div class="button-row">${button('cancel-path', '取消', '', 'subtle')}${button('finish-path', '完成路线', '', 'primary wide')}</div>` : `<div class="button-row">${button('focus', '定位对象', '', 'subtle wide')}${button('duplicate', '', 'copy', 'icon-button', 'title="复制对象"')}${button('delete', '', 'trash', 'icon-button danger', 'title="删除对象"')}</div>`;
        if (ctx.inspectorTab === 'camera') $('#inspector-footer .button-row')?.insertAdjacentHTML('beforeend', button('camera-hidden-open', '', 'eye', 'icon-button', `title="本机位隐藏对象 · ${e.camera?.hiddenEntityIds?.length ?? 0}" aria-label="本机位隐藏对象"`));
        if (e.kind === 'prop' && !ctx.draft) $('#inspector-footer .button-row')?.insertAdjacentHTML('beforeend', button('replace-prop-open', '', 'folder', 'icon-button', 'title="替换道具模型" aria-label="替换道具模型"'));
        if (e.locked) {
            document.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('#inspector-content input,#inspector-content select,#inspector-content button,#inspector-footer button').forEach(el => {
                const act = el.dataset.act;
                el.disabled = !el.dataset.lightTab && !el.dataset.cinemaTab && !el.dataset.inspectorSection && el.dataset.stepPoint === undefined && !['curve-channel', 'curve-segment', 'lighting-channel', 'lighting-key', 'cinema-channel', 'cinema-key', 'legacy-parameter-choice', 'path-section-choice', 'pose-group', 'pose-key-choice', 'path-point-choice', 'basic-clip-choice', 'hand-target', 'hand-parameter', 'contact-choice', 'contact-parameter', 'asset-parameter-key', 'external-parameter-key', 'rig-view', 'rig-part', 'native-source', 'native-clip', 'native-parameter', 'retarget-source', 'retarget-clip', 'retarget-parameter'].includes(el.id) && !el.dataset.rigReadonly && el.dataset.rigAction !== 'focus' && el.dataset.field !== 'locked' && !['nodes-open','unlock-selected','focus','duplicate','preview-selected','cut-selected','select-point','seek-key'].includes(act ?? '');
            });
        }
    }
    return { transformFields, renderInspector, handle(action: string) {
        if (colorPalette.handle(action)) return true;
        if (action === 'ai-changes-open') { editLocations.open(); return true; }
        if (timelineCurves.handle(action)) return true;
        if (document.querySelector('[data-inspector-part="effects"]') && cameraEffects.handle(action)) return true;
        if (ctx.inspectorTab === 'light' || ctx.inspectorTab === 'environment') return lightingEditor.handle(action);
        return false;
    } };
}
