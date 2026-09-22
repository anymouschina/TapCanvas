import { setSelectedEntities } from './editor/timeline-selection.ts';
import { mountApplicationMenu } from './ui/application-menu.ts';
import { saveProjectFile } from './ui/project-save.ts';
import { mountFileLocations } from './ui/file-locations.ts';
import { mountSettings } from './ui/settings-panel.ts';
import { bindLiveFields } from './ui/live-fields.ts';
import { selectClip } from './ui/clip-controls.ts';
import { captureStructureEdits, syncStructureLinks } from './building/structure-links.ts';
import { syncFloorElevations } from './building/floors.ts';
import { editBoundTransform } from './animation/hand-binding.ts';
import { isAnimalAsset } from './asset-catalog.ts';
import { createToolService } from './automation/service.ts';
import { mountAI } from './ui/ai-panel.ts';
import { mountUpdates } from './ui/update-panel.ts';
import { recordPositionKey } from './editor/position-keys.ts';
import * as T from 'three';
import { extendTimelineView } from './ui/timeline-zoom.ts';
import { assertLockedEntitiesUnchanged } from './editor/invariants.ts';
import { freezeCamera } from './editor/camera-editing.ts';
import { bindNavigation } from './editor/navigation.ts';
import { mountModelControl } from './ui/model-control.ts';
import { bindResizableLayout } from './ui/resizable-layout.ts';
import { createScene, type SceneTemplate } from './scenes.ts';
import { createEditingTools } from './editor/operations.ts';
import { Engine } from './engine.ts';
import type { Action, Entity, Project, Vec3 } from './model.ts';
import { assertProject, clone } from './model.ts';
import { autosave, recover } from './storage.ts';
import { SceneWorkspace } from './scenes/scene-workspace.ts';
import { RecoveryAutosave } from './editor/recovery-autosave.ts';
import { readSceneDocument, projectForScene, type SceneDocument } from './scenes/sequence-project.ts';
import type { SceneContext } from './scenes/sequence-session.ts';
import { prepareDocumentModels } from './scenes/document-models.ts';
import { renderSceneSwitcher } from './ui/scene-sequence-panel.ts';
import { cameraMonitor } from './ui/camera-monitor.ts';
import './style.css';
import './ui/responsive-panels.css';
import './ui/asset-browser.css';
import './ui/workspace-shell.css';
import './ui/fixed-zones.css';
import './ui/dialog-shell.css';
import './ui/video-panel.css';
import { entityPosition, shiftPath } from './timeline.ts';
import { createCommands } from './ui/commands.ts';
import type { AppContext } from './app-context.ts';
import { createDialogs } from './ui/dialogs.ts';
import { bindEvents } from './ui/events.ts';
import { createInspector } from './ui/inspector.ts';
import { mountLayout } from './ui/layout.ts';
import { createSidebar } from './ui/sidebar.ts';
import { createTimeline } from './ui/timeline.ts';
import { createVideoPanel } from './ui/video-panel.ts';
import { $, escape, icon } from './ui/common.ts';
let project = createScene('light-stage'), selected = project.entities[0].id, inspectorTab = 'base', sidebarTab = 'scene', assetFilter = '全部', query = '';
let time = 0, playing = false, loop = false, mode = 'split', preview = 'program', revision = 0, dirty = false, busy = false;
let inspectorRenderedFor = '';
let draft: {
    id: string;
} | null = null;
const history = new SceneWorkspace(project, () => ({ time, selected, preview }));
const recoverySave = new RecoveryAutosave(force => autosave(() =>
    history.pending || draft || engine.dragging || engine.exporting || busy && !force ? null : history.document()),
    () => { $('#save-status').textContent = '自动恢复已保存'; },
    () => { $('#save-status').textContent = '请手动保存项目'; toast('自动恢复保存失败，请导出项目文件备份', true); });
let inspectorSeekTimer: ReturnType<typeof setTimeout> | undefined;
let aborter: AbortController | null = null;
let transformError: Error | undefined;
mountLayout(project);
const engine = new Engine(project, $('#stage-canvas'), $('#shot-canvas'), {
    select: selectEntity, point: i => { engine.select(selected, i); inspectorTab = 'path'; renderInspector(); }, ground: addGroundPoint,
    transformStart: () => { transformError=undefined; playing = false; history.begin(project); const e = current(); if (e?.camera && e.camera.mode !== 'free') freezeCamera(engine, e); },
    transform: (p, r, s) => {
        const e = current();
        if (!e || transformError)
            return;
        const beforeTransform = captureStructureEdits(project);
        if (e.handBinding && engine.gizmo.getMode() !== 'scale') {
            editBoundTransform(e, engine.handFrame(e.handBinding), engine.gizmo.getMode() === 'translate' ? p : undefined, engine.gizmo.getMode() === 'rotate' ? r : undefined);
        }
        else if (!e.structureLink && engine.positionKeying && engine.gizmo.getMode() === 'translate') {
            try { recordPositionKey(e,time,p,project.fps); extendDuration(); } catch(error) {transformError=error as Error;engine.syncProxy();return;}
            engine.proxy.position.fromArray(p);
        }
        else if (engine.selectedPoint >= 0 && e.path)
            e.path.points[engine.selectedPoint].position = p;
        else if (engine.gizmo.getMode() === 'translate') {
            const snapped = engine.snapObjectPosition(e.id, p, engine.gizmo.axis ?? 'XYZ');
            shiftPath(e, new T.Vector3(...snapped).sub(entityPosition(e, time)));
            engine.proxy.position.fromArray(snapped);
        }
        else if (engine.gizmo.getMode() === 'rotate')
            e.rotation = r;
        else {
            e.scale = s.map(v => Math.max(.05, v)) as Vec3;
        }
        try { syncStructureLinks(project, beforeTransform); } catch (error) { transformError = error as Error; return; }
        engine.sample(time);
        engine.refreshHelpers();
    }, transformEnd: (cancel=false) => {
        try {
            if(cancel || transformError)throw transformError ?? new Error('已取消拖动');
            assertLockedEntitiesUnchanged(history.pending!,project);assertProject(project);
            history.commit(project);changed(false);
        }catch(error){
            project=history.rollback()??project;selected=history.restoredSelection??selected;
            engine.selected=selected;engine.rebuild(project);renderPanels();
            if(!cancel)toast((error as Error).message,true);
        }
        transformError=undefined;
    },
});
function current() { return project.entities.find(e => e.id === selected); }
function toast(message: string, error = false) { const el = document.createElement('div'); el.className = 'toast' + (error ? ' error' : ''); el.textContent = message; $('#toasts').append(el); while ($('#toasts').children.length > 3) $('#toasts').firstElementChild!.remove(); setTimeout(() => el.remove(), 5000); }
function changed(rebuild = true) { revision++; dirty = true; time = Math.max(0, time); if (!current()) selected = project.entities.find(e => e.kind === 'actor')?.id ?? project.entities[0].id; engine.selected = selected; $('#save-status').textContent = '正在保存恢复副本…'; if (rebuild)
    engine.rebuild(project);
else {
    engine.project = project;
    engine.sample(time);
    engine.refreshHelpers();
} engine.select(selected, engine.selectedPoint); renderPanels(); engine.externalModels.retain([project, ...history.undoStack, ...history.redoStack]); recoverySave.request(); }
function change(fn: () => void, rebuild = true): boolean { if (busy)
    return false; if (draft || history.pending) { toast('请先完成或取消当前绘制／拖动操作'); return false; } playing = false; const original = project; history.begin(project); try {
    fn();
    if (project === original) { syncFloorElevations(project, history.pending!); syncStructureLinks(project, history.pending!); }
    if (project === original) assertLockedEntitiesUnchanged(history.pending!, project);
    assertProject(project);
    engine.externalModels.assertReady(project);
    history.commit(project);
    changed(rebuild);
    return true;
}
catch (error) {
    project = history.rollback() ?? project;
    selected = history.restoredSelection || selected;
    engine.selected = selected;
    engine.rebuild(project);
    renderPanels();
    selectClip(null);
    toast((error as Error).message, true);
    return false;
} }
function extendDuration() { for (const e of project.entities) {
    project.duration = Math.max(project.duration, ...e.clips.map(c => c.end), ...(e.path?.sections?.map(s => s.end) ?? e.path?.points.map(p => p.time) ?? []), ...e.poseKeys.map(k => k.time), ...(e.camera?.targetPath?.points.map(p => p.time) ?? []));
} }
function selectEntity(id: string, preserveTimelineSelection = false) { if(!preserveTimelineSelection)setSelectedEntities([id]); if (draft)
    finishPath(); selected = id; const e = current(); if (!e)
    return; if (e.light) inspectorTab = 'light';
else if (e.kind === 'camera')
    inspectorTab = 'camera';
else if (!['base', 'path', 'actions', 'pose', 'structure'].includes(inspectorTab) || e.kind === 'prop' && ['actions', 'pose'].includes(inspectorTab))
    inspectorTab = 'base'; engine.select(id); renderPanels(); }
function renderPanels() {
    document.title = `${project.name} · 导演台${import.meta.env.DEV ? ' · 开发测试版' : ''}`;
    renderSceneSwitcher(uiContext);
    $('#aspect').value = project.aspect;
    document.querySelectorAll<HTMLElement>('[data-creation-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.creationMode === (project.creationMode ?? 'full'))));
    $<HTMLInputElement>('#reference-labels').checked = project.referenceLabels ?? false;
    $('#fps').value = String(project.fps);
    $('#duration').value = String(project.duration);
    $('#duration-label').textContent = `${project.duration.toFixed(1)} s`;
    $('#room-badge').textContent = project.room.enabled ? `${project.room.width} × ${project.room.depth} m / 层高 ${project.room.height} m` : '室外 / 自由搭建 · 1 格 = 1 米';
    const animalCount = project.entities.filter(e => isAnimalAsset(e.asset)).length;
    $('#scene-status').textContent = `${project.entities.filter(e => e.kind === 'actor' && !isAnimalAsset(e.asset)).length} 人${animalCount ? ` · ${animalCount} 只动物` : ''} · ${project.entities.filter(e => e.kind === 'camera').length} 台摄影机 · ${project.entities.filter(e => e.kind === 'prop').length} 件道具`;
    $('#selection-status').textContent = current() ? `已选：${current()!.name}` : '请选择人物、道具或摄影机';
    renderSidebar();
    renderInspector();
    renderTimeline();
    renderCameras();
    updateTimeUI();
}
function renderCameras() {
    const cameras = project.entities.filter(e => e.kind === 'camera');
    if (preview !== 'program' && !cameras.some(c => c.id === preview))
        preview = 'program';
    engine.previewId = preview;
    $('#camera-buttons').innerHTML = cameraMonitor(cameras, preview);
    document.querySelector<HTMLButtonElement>('[data-act="insert-cut"]')!.disabled = preview === 'program';
}
function timeCode(t: number) { const frames = Math.round(t * project.fps), f = frames % project.fps, s = Math.floor(frames / project.fps); return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60, f].map(x => String(x).padStart(2, '0')).join(':'); }
function updateTimeUI() {
    $('#timecode').textContent = timeCode(time);
    $('#shot-time').textContent = timeCode(time);
    $('#timeline-content').style.setProperty('--timeline-playhead', String(time));
    const play = $<HTMLButtonElement>('[data-act="play"]');
    const label = playing ? '暂停' : '播放';
    // Preserve the pointer target between press and release, including a slow click.
    if (play.getAttribute('aria-label') !== label) {
        play.innerHTML = icon(playing ? 'pause' : 'play');
        play.setAttribute('aria-label', label);
    }
}
const labelNodes = new Map<string, HTMLButtonElement>();
const frameFields = new Map(['object-snap-status','shot-name','shot-lens','shot-warning'].map(id => [id,$('#'+id)]));
function frameText(id: string, value: string) { const node=frameFields.get(id)!; if(node.textContent!==value)node.textContent=value; }
engine.onFrame = () => {
    frameText('object-snap-status', engine.objectSnapEnabled && engine.objectSnapTarget ? `已吸附：${engine.objectSnapTarget}` : '');
    const camera = engine.cameraEntity();
    frameText('shot-name', camera.name + (preview === 'program' ? ' · 成片' : ''));
    frameText('shot-lens', `${camera.camera!.focal} mm · ${project.aspect}`);
    const p = engine.getShotCamera().position, r = project.room;
    const outside = r.enabled && (Math.abs(p.x) > r.width / 2 || Math.abs(p.z) > r.depth / 2 || p.y > r.height || p.y < 0);
    const hiddenObjects = camera.camera!.hiddenEntityIds?.length ?? 0;
    frameText('shot-warning', hiddenObjects ? `本机位隐藏 ${hiddenObjects} 个对象${camera.camera!.hideWalls.length ? `、${camera.camera!.hideWalls.length} 面房间墙体` : ''}` : outside && !camera.camera!.hideWalls.length ? '机位在房间外 · 墙体保留' : camera.camera!.hideWalls.length ? `已移除 ${camera.camera!.hideWalls.length} 面拍摄墙体` : '同场景真实取景');
    if (mode === 'shot') return;
    const labels = engine.getProjectedLabels(), ids = new Set(labels.map(l => l.id));
    for (const [id, node] of labelNodes)
        if (!ids.has(id)) {
            node.remove();
            labelNodes.delete(id);
        }
    for (const l of labels) {
        let node = labelNodes.get(l.id);
        if (!node) {
            node = document.createElement('button');
            node.dataset.select = l.id;
            $('#object-labels').append(node);
            labelNodes.set(l.id, node);
        }
        const className='object-label' + (l.id === selected ? ' active' : '');
        if(node.className!==className)node.className=className;
        if(node.style.left!==l.x+'px')node.style.left=l.x+'px';
        if(node.style.top!==l.y+'px')node.style.top=l.y+'px';
        if(node.hidden===l.visible)node.hidden=!l.visible;
        if (node.dataset.name !== l.name || node.dataset.color !== l.color) {
            node.innerHTML = `<i style="background:${l.color}"></i>${escape(l.name)}`;
            node.dataset.name = l.name;
            node.dataset.color = l.color;
        }
    }
};
function seek(t: number, deferSample = false) { if (busy)
    return; time = Math.max(0, Number.isFinite(t) ? t : 0); extendTimelineView(uiContext, time); if(!deferSample)engine.sample(time); updateTimeUI();
    clearTimeout(inspectorSeekTimer);
    inspectorSeekTimer = setTimeout(() => { if (!draft && !busy && !engine.dragging && !document.activeElement?.closest('#inspector-content input,#inspector-content select,#timeline-curves')) renderInspector(); }, 80);
}
function setView(value: string) { if (!['stage', 'split', 'shot'].includes(value)) return; mode = value; $('#viewports').className = 'viewports ' + value; document.querySelectorAll('.view-modes button[data-view]').forEach(el => el.classList.toggle('active', (el as HTMLElement).dataset.view === value)); engine.requestResize(); }
async function saveProject() { return saveProjectFile(uiContext); }
function applyDocument(document: SceneDocument, context: SceneContext, label: string, resetViews = false) {
    if (draft || history.pending || engine.exporting) throw Error('请先完成当前编辑或导出');
    for (const scene of document.scenes) engine.externalModels.assertReady(projectForScene(document, scene.id));
    project = history.replace(document, context, label, resetViews);
    restoreSceneView();
}
function switchScene(id: string, context: SceneContext) {
    if (draft || history.pending || engine.exporting) throw Error('请先完成当前编辑或导出');
    engine.externalModels.assertReady(history.projectFor(id));
    project = history.switchScene(id, context);
    restoreSceneView();
}
function restoreSceneView() {
    const view = history.restoredView!; time = view.time; selected = view.selected; preview = view.preview;
    playing = false; selectClip(null); engine.selectedPoint = -1; inspectorTab = 'base';
    changed(); extendTimelineView(uiContext, time); $('#timeline-center').click();
}
function createNew(template: SceneTemplate = 'bedroom') {
    if (draft) cancelPath();
    closeModal();
    try {
        applyDocument(readSceneDocument(createScene(template)), history.context, '新建工程', true);
        sidebarTab = 'scene'; query = ''; engine.viewHome(); setView('split'); renderPanels();
        toast('已新建' + project.name + '；可撤销返回上个项目');
    } catch (error) { toast((error as Error).message, true); }
}
let previousFrame = performance.now(), lastUI = 0;
function frame(now: number) { const delta = Math.min((now - previousFrame) / 1000, .1); previousFrame = now; if (!busy && !engine.exporting) {
    if (playing) {
        time += delta;
        if (time >= project.duration) {
            if (loop)
                time %= project.duration;
            else {
                time = project.duration;
                playing = false;
            }
        }
    }
    navigation.update(delta);
    if (playing || time !== engine.time || history.pending || draft || engine.dragging) engine.sample(time);
    engine.render(false);
    if (now - lastUI > 50) {
        updateTimeUI();
        lastUI = now;
    }
} requestAnimationFrame(frame); }
const uiContext: AppContext = {
    get project() { return project; }, set project(value) { project = value; },
    get selected() { return selected; }, set selected(value) { selected = value; },
    get inspectorTab() { return inspectorTab; }, set inspectorTab(value) { inspectorTab = value; },
    get sidebarTab() { return sidebarTab; }, set sidebarTab(value) { sidebarTab = value; },
    get assetFilter() { return assetFilter; }, set assetFilter(value) { assetFilter = value; },
    get query() { return query; }, set query(value) { query = value; },
    get time() { return time; }, set time(value) { time = value; },
    get playing() { return playing; }, set playing(value) { playing = value; },
    get loop() { return loop; }, set loop(value) { loop = value; },
    get mode() { return mode; }, set mode(value) { mode = value; },
    get preview() { return preview; }, set preview(value) { preview = value; },
    get dirty() { return dirty; }, set dirty(value) { dirty = value; },
    get revision() { return revision; },
    get busy() { return busy; }, set busy(value) { busy = value; },
    get draft() { return draft; }, set draft(value) { draft = value; },
    get aborter() { return aborter; }, set aborter(value) { aborter = value; },
    get engine() { return engine; }, history, scenes: history, applyDocument, switchScene, current, toast, change, changed, extendDuration, selectEntity, renderPanels, renderSidebar, renderInspector, renderTimeline, renderCameras, updateTimeUI, seek, saveProject, showModal, closeModal, projectDialog, roomDialog, sceneDialog, createNew, makeCamera, startPath, finishPath, cancelPath, replaceAction, deleteDialog, deleteEntity, seatDialog, seatApply, snapshot, exportDialog, startExport, helpDialog, updateExportSummary, setView, addAsset, addGroundPoint, retimePath, applyField, applyMotion, applyFraming, act
};
const editingTools = createEditingTools(uiContext);
bindEvents(uiContext);
const navigation = bindNavigation(uiContext);
mountModelControl(uiContext);
bindResizableLayout();
const sidebarUI = createSidebar(uiContext);
const inspectorUI = createInspector(uiContext);
const timelineUI = createTimeline(uiContext);
const dialogsUI = createDialogs(uiContext);
const videopanelUI = createVideoPanel(uiContext);
const commandsUI = createCommands(uiContext, inspectorUI);
const toolService = createToolService(uiContext);
window.directorDesktop?.onTool((name, args) => toolService.call(name, args));
mountAI(uiContext);
mountFileLocations(uiContext);
mountSettings(uiContext);
bindLiveFields(uiContext, editingTools.mutateField);
mountUpdates(async run => {
    if (busy || history.pending || draft || document.querySelector('#ai-panel')?.getAttribute('data-running') === 'true') throw Error('请先完成当前编辑、导出或 AI 任务');
    busy = true; playing = false;
    try { await recoverySave.flush(); await run(); } finally { busy = false; }
});
mountApplicationMenu();
renderPanels();
engine.select(selected);
requestAnimationFrame(frame);
void recover().then(async p => { if (p && revision === 0) {
    await prepareDocumentModels(engine.externalModels, p);
    if (revision !== 0 || busy || history.pending || draft) { engine.externalModels.retain([project, ...history.undoStack, ...history.redoStack]); return; }
    selectClip(null);project = history.reset(p);
    selected = history.restoredSelection!; time = 0; preview = 'program';
    engine.selected = selected; engine.rebuild(project);
    renderPanels();
    dirty = true; toast('已恢复上次工作');
} }).catch(() => toast('未能读取自动恢复或模型资源，可以打开手动保存的项目文件'));
window.addEventListener('beforeunload', event => { if (dirty || busy || history.pending || draft) {
    event.preventDefault();
    event.returnValue = '';
} });
if (import.meta.env.DEV) {
    if (!document.title.endsWith(' · 开发测试版')) document.title += ' · 开发测试版';
    Object.assign(window, { __director: { callTool: (name: string, args: Record<string, unknown> = {}) => toolService.call(name, args), getProject: () => clone(project), getDocument: () => history.document(), getEngine: () => engine, setTime: (t: number) => { playing = false; seek(t); }, setPreview: (id: string) => { preview = id; renderCameras(); }, replaceProject: (p: Project | SceneDocument) => { selectClip(null);project = history.reset(p); revision++; selected = project.entities[0].id; time = 0; engine.rebuild(project); renderPanels(); }, signature: () => engine.projectionSignature(), exportForTest: async (opts: Parameters<typeof import('./export.ts')['exportVideo']>[1]) => { const { exportVideo } = await import('./export.ts'); const blob = await exportVideo(engine, opts, new AbortController().signal, () => { }); return blob ? Array.from(new Uint8Array(await blob.arrayBuffer())) : []; } } });
}
function renderSidebar() { sidebarUI.renderSidebar(); }
function renderInspector() { clearTimeout(inspectorSeekTimer); const key = selected + ':' + inspectorTab; const scroll = key === inspectorRenderedFor ? $('#inspector-content').scrollTop : 0; inspectorUI.renderInspector(); inspectorRenderedFor = key; $('#inspector-content').scrollTop = scroll; }
function renderTimeline() { timelineUI.renderTimeline(); }
function showModal(title: string, body: string, footer = '') { dialogsUI.showModal(title, body, footer); }
function closeModal() { dialogsUI.closeModal(); }
function sceneDialog() { dialogsUI.sceneDialog(); }
function projectDialog() { dialogsUI.projectDialog(); }
function roomDialog() { dialogsUI.roomDialog(); }
function deleteDialog(e: Entity) { dialogsUI.deleteDialog(e); }
function seatDialog() { dialogsUI.seatDialog(); }
function helpDialog() { dialogsUI.helpDialog(); }
async function snapshot() { await videopanelUI.snapshot(); }
function exportDialog() { videopanelUI.exportDialog(); }
function updateExportSummary() { videopanelUI.updateExportSummary(); }
async function startExport() { await videopanelUI.startExport(); }
async function act(action: string, el: HTMLElement) { await commandsUI.act(action, el); }
function addAsset(id: string, position?: Vec3) { editingTools.addAsset(id, position); }
function makeCamera(fromView = false) { editingTools.makeCamera(fromView); }
function startPath() { editingTools.startPath(); }
function addGroundPoint(position: Vec3) { editingTools.addGroundPoint(position); }
function finishPath() { editingTools.finishPath(); }
function cancelPath() { editingTools.cancelPath(); }
function replaceAction(e: Entity, action: Action, start: number, end: number) { editingTools.replaceAction(e, action, start, end); }
function retimePath(e: Entity, start: number, end: number) { editingTools.retimePath(e, start, end); }
function applyField(key: string, value: string) { editingTools.applyField(key, value); }
function deleteEntity(id: string, replacement?: string) { editingTools.deleteEntity(id, replacement); }
function seatApply() { editingTools.seatApply(); }
function applyMotion(name: string) { editingTools.applyMotion(name); }
function applyFraming(name: string) { editingTools.applyFraming(name); }
