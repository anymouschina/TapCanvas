import { createSceneSequencePanel } from './scene-sequence-panel.ts';
import { mirrorPose } from '../assets/joint-schema.ts';
import { createModelNodesPanel } from './model-nodes-panel.ts';
import { createResourcePanel } from './resource-panel.ts';
import { createResourceStatisticsPanel } from './resource-statistics-panel.ts';
import { createReplacePropPanel } from './replace-prop-panel.ts';
import { createSceneReusePanel } from './scene-reuse-panel.ts';
import { createCameraVisibilityPanel } from './camera-visibility-panel.ts';
import { createStructureLinkPanel } from './structure-link-panel.ts';
import { createCameraLookPanel } from './camera-look-panel.ts';
import { createZonePanel } from './zone-panel.ts';
import { createFloorPanel } from './floor-panel.ts';
import { createPathSurfacePanel } from './path-surface-panel.ts';
import { createModelImport } from './model-import.ts';
import { createUserMotionPanel } from './user-motion-panel.ts';
import { findAsset } from '../asset-catalog.ts';
import { selectClip } from './clip-controls.ts';
import { createSpatialPanel } from './spatial-panel.ts';
import { createSpatialRangePanel } from './spatial-range-panel.ts';
import { createProductionPanel } from './production-panel.ts';
import { recordPositionKey } from '../editor/position-keys.ts';
import { staticStructure } from '../building/structure-links.ts';
import { pathSections } from '../clip-editing.ts';
import * as T from 'three';
import { freezeCamera } from '../editor/camera-editing.ts';
import type { Vec3 } from '../model.ts';
import { clone, uid } from '../model.ts';
import { addCut, entityPosition, samplePose, shiftPath } from '../timeline.ts';
import { $, button } from './common.ts';
import type { AppContext } from '../app-context.ts';
export function createCommands(ctx: AppContext, inspectorTools: { handle(action: string): boolean }) {
    const sceneSequence = createSceneSequencePanel(ctx);
    const modelNodes = createModelNodesPanel(ctx);
    const resources = createResourcePanel(ctx), replacements = createReplacePropPanel(ctx);
    const resourceStatistics = createResourceStatisticsPanel(ctx);
    const sceneReuse = createSceneReusePanel(ctx), cameraVisibility = createCameraVisibilityPanel(ctx);
    const floorPanel = createFloorPanel(ctx), zonePanel = createZonePanel(ctx), lookPanel = createCameraLookPanel(ctx);
    const structurePanel = createStructureLinkPanel(ctx);
    const surfacePanel = createPathSurfacePanel(ctx);
    const modelImport = createModelImport(ctx);
    const userMotion = createUserMotionPanel(ctx);
    const spatialPanel = createSpatialPanel(ctx);
    const rangePanel = createSpatialRangePanel(ctx);
    const productionPanel = createProductionPanel(ctx);
    async function act(action: string, el: HTMLElement) {
        const e = ctx.current();
        if (ctx.busy && !['cancel-export', 'range-cancel', 'production-cancel', 'model-cancel', 'scene-reuse-cancel'].includes(action))
            return;
        if (ctx.history.pending && !ctx.draft && action !== 'cancel-export') { ctx.toast('请先结束当前拖动操作'); return; }
        if (ctx.draft && !['finish-path', 'cancel-path', 'undo', 'save', 'home', 'top', 'grid', 'focus', 'help', 'close-modal'].includes(action)) { ctx.toast('请先完成路线，或按 Esc 取消'); return; }
        if (sceneSequence.handle(action)) return;
        if (modelImport.handle(action)) return;
        if (userMotion.handle(action)) return;
        if (modelNodes.handle(action)) return;
        if (resources.handle(action) || replacements.handle(action)) return;
        if (resourceStatistics.handle(action)) return;
        if (sceneReuse.handle(action) || cameraVisibility.handle(action)) return;
        if (surfacePanel.handle(action)) return;
        if (['cinema-open', 'lighting-open', 'light-open', 'inspector-return'].includes(action)) {
            ctx.inspectorTab = action === 'cinema-open' ? 'effects' : action === 'lighting-open' ? 'environment' : action === 'light-open' ? 'light' : e?.camera ? 'camera' : 'base';
            ctx.renderInspector(); return;
        }
        if (inspectorTools.handle(action)) return;
        if (structurePanel.handle(action)) return;
        if (floorPanel.handle(action) || zonePanel.handle(action) || lookPanel.handle(action)) return;
        if (spatialPanel.handle(action)) return;
        if (rangePanel.handle(action)) return;
        if (productionPanel.handle(action, el)) return;
        switch (action) {
            case 'initial-pose-clear':
                if (e && !e.locked) ctx.change(() => { delete e.initialPose; });
                break;
            case 'position-key':
                if(e && !e.locked){
                    ctx.change(()=>{
                        if(e.camera && e.camera.mode!=='free')freezeCamera(ctx.engine,e);
                        recordPositionKey(e,ctx.time,entityPosition(e,ctx.time).toArray() as Vec3,ctx.project.fps);ctx.extendDuration();
                        ctx.engine.positionKeying=true;ctx.engine.select(e.id,-1);
                        $<HTMLSelectElement>('#position-edit-mode').value='key';ctx.inspectorTab='path';
                    },false);
                }
                break;
            case 'adjoin-prop':
                if (!e || !staticStructure(e)) { ctx.toast('请先解除模块路径、手持或动画，再连接搭建'); break; }
                if(e?.kind==='prop')ctx.change(()=>{
                    const copy=clone(e);copy.id=uid();copy.name+=' 接段';copy.locked=false;
                    copy.structureLink={parentId:e.id,parentPort:'out',ownPort:'in',offset:[0,0,0],rotation:[0,0,0]};
                    ctx.project.entities.push(copy);ctx.selected=copy.id;
                });
                break;
            case 'translate':
            case 'rotate':
            case 'scale':
                if (e?.camera && action === 'rotate') {
                    ctx.change(() => { if (e.camera!.mode !== 'free') freezeCamera(ctx.engine, e); const r = ctx.engine.cameras.get(e.id)!.rotation; e.rotation = [r.x, r.y, r.z]; e.camera!.mode = 'free'; e.camera!.aim = 'manual'; }, false);
                    ctx.toast('已切换手动机位朝向，可用旋转工具调整');
                }
                ctx.engine.setTransformMode(action);
                document.querySelectorAll('[data-act="translate"],[data-act="rotate"],[data-act="scale"]').forEach(b => b.classList.toggle('active', (b as HTMLElement).dataset.act === action));
                break;
            case 'home':
                ctx.engine.viewHome();
                break;
            case 'top':
                ctx.engine.viewTop();
                break;
            case 'grid':
                ctx.engine.gridVisible = !ctx.engine.gridVisible;
                ctx.engine.refreshHelpers();
                el.classList.toggle('active', ctx.engine.gridVisible);
                break;
            case 'focus':
                if (e)
                    ctx.engine.focus(e.id);
                break;
            case 'play':
                if (ctx.time >= ctx.project.duration)
                    ctx.seek(0);
                ctx.playing = !ctx.playing;
                ctx.updateTimeUI();
                break;
            case 'begin':
                ctx.playing = false;
                ctx.seek(0);
                break;
            case 'prev':
                ctx.playing = false;
                ctx.seek(ctx.time - 1 / ctx.project.fps);
                break;
            case 'next':
                ctx.playing = false;
                ctx.seek(ctx.time + 1 / ctx.project.fps);
                break;
            case 'loop':
                ctx.loop = !ctx.loop;
                el.classList.toggle('active', ctx.loop);
                break;
            case 'save':
                await ctx.saveProject();
                break;
            case 'open':
                if (ctx.dirty)
                    ctx.showModal('打开项目', '<p class="modal-copy">当前修改尚未导出为项目文件。建议先保存，再打开其他项目。</p>', button('save-then-open', '保存后打开', '', 'primary') + button('choose-project', '直接打开', '', 'subtle'));
                else
                    $('#project-file').click();
                break;
            case 'save-then-open':
                if (!await ctx.saveProject()) break;
                ctx.closeModal();
                $('#project-file').click();
                break;
            case 'choose-project':
                ctx.closeModal();
                $('#project-file').click();
                break;
            case 'undo': {
                if (ctx.draft) {
                    ctx.cancelPath();
                    break;
                }
                const label = ctx.scenes.undoLabel;
                ctx.playing = false;
                const p = ctx.history.undo(ctx.project);
                if (p) {
                    selectClip(null);ctx.engine.selectedPoint = -1;ctx.project = p;
                    ctx.selected = ctx.history.restoredSelection ?? ctx.selected;
                    if (ctx.history.restoredView) { ctx.time = ctx.history.restoredView.time; ctx.preview = ctx.history.restoredView.preview; }

                    ctx.changed();
                    if (label) ctx.toast(`${label.label} · ${label.sceneName}`);
                }
                break;
            }
            case 'redo': {
                const label = ctx.scenes.redoLabel;
                ctx.playing = false;
                const p = ctx.history.redo(ctx.project);
                if (p) {
                    selectClip(null);ctx.engine.selectedPoint = -1;ctx.project = p;
                    ctx.selected = ctx.history.restoredSelection ?? ctx.selected;
                    if (ctx.history.restoredView) { ctx.time = ctx.history.restoredView.time; ctx.preview = ctx.history.restoredView.preview; }
                    ctx.changed();
                    if (label) ctx.toast(`${label.label} · ${label.sceneName}`);
                }
                break;
            }
            case 'project':
                ctx.projectDialog();
                break;
            case 'room':
                ctx.roomDialog();
                break;
            case 'scene-templates':
            case 'new-project':
                ctx.sceneDialog();
                break;
            case 'save-and-new':
                if (!await ctx.saveProject()) break;
                ctx.createNew(($<HTMLInputElement>('input[name="scene-template"]:checked')?.value ?? 'bedroom') as import('../scenes.ts').SceneTemplate);
                break;
            case 'confirm-new':
                ctx.createNew(($<HTMLInputElement>('input[name="scene-template"]:checked')?.value ?? 'bedroom') as import('../scenes.ts').SceneTemplate);
                break;
            case 'add-camera':
                ctx.makeCamera();
                break;
            case 'new-from-view':
                ctx.makeCamera(true);
                break;
            case 'draw-path':
                ctx.startPath();
                break;
            case 'finish-path':
                ctx.finishPath();
                break;
            case 'cancel-path':
                ctx.cancelPath();
                break;
            case 'clear-path':
                selectClip(null);
                if (e)
                    ctx.change(() => { e.position = entityPosition(e, ctx.time).toArray() as Vec3; e.path = null; }, false);
                break;
            case 'seek-position-key': {
                const owner=ctx.project.entities.find(e=>e.id===el.dataset.id);
                if(owner?.path){ctx.selectEntity(owner.id);ctx.inspectorTab='path';ctx.seek(owner.path.points[Number(el.dataset.index)].time);ctx.engine.select(owner.id,Number(el.dataset.index));ctx.renderInspector();}
                break;
            }
            case 'select-point':
                ctx.engine.select(ctx.selected, Number(el.dataset.index));
                ctx.renderInspector();
                break;
            case 'append-point':
                if (e?.path)
                    ctx.change(() => { const last = e.path!.points.at(-1)!; e.path!.points.push({ time: last.time + 2, position: [last.position[0] + .5, last.position[1], last.position[2]] }); ctx.extendDuration(); }, false);
                break;
            case 'hold-point':
                if (e?.path)
                    ctx.change(() => {
                        const idx = ctx.engine.selectedPoint >= 0 ? ctx.engine.selectedPoint : e.path!.points.length - 1;
                        const p = e.path!.points[idx];
                        for (let i = idx + 1; i < e.path!.points.length; i++)
                            e.path!.points[i].time += 1;
                        e.path!.points.splice(idx + 1, 0, { time: p.time + 1, position: [...p.position] });
                        ctx.extendDuration();
                    }, false);
                break;
            case 'remove-point':
                if (e?.path)
                    ctx.change(() => {
                        e.path!.points.splice(Number(el.dataset.index), 1);
                        if (e.path!.points.length < 1)
                            e.path = null;
                        ctx.engine.selectedPoint = -1;
                    }, false);
                break;
            case 'path-walk':
            case 'path-run':
                if (e?.path)
                    ctx.change(() => { for (const part of pathSections(e.path!)) ctx.replaceAction(e, action === 'path-walk' ? 'walk' : 'run', part.start, part.end); }, false);
                break;
            case 'remove-clip':
                if (e)
                    ctx.change(() => e.clips = e.clips.filter(c => c.id !== el.dataset.id), false);
                break;
            case 'pose-reset':
                if (e)
                    ctx.change(() => { e.pose = {}; if (e.poseKeys.length) {
                        const at = Math.round(ctx.time * ctx.project.fps) / ctx.project.fps;
                        const key = e.poseKeys.find(k => Math.abs(k.time - at) < 1e-6);
                        if (key)
                            key.pose = {};
                        else
                            e.poseKeys.push({ time: at, pose: {} });
                        e.poseKeys.sort((a, b) => a.time - b.time);
                    } }, false);
                break;
            case 'pose-mirror':
                if (e)
                    ctx.change(() => {
                        const pose = clone(samplePose(e, ctx.time));
                        const mirrored = mirrorPose(pose, findAsset(e.asset)?.capabilities?.rig === 'serpent');
                        if (e.poseKeys.length) {
                            const at = Math.round(ctx.time * ctx.project.fps) / ctx.project.fps;
                            const key = e.poseKeys.find(k => Math.abs(k.time - at) < 1e-6);
                            if (key) key.pose = mirrored;
                            else e.poseKeys.push({ time: at, pose: mirrored });
                            e.poseKeys.sort((a, b) => a.time - b.time);
                        } else e.pose = mirrored;
                    }, false);
                break;
            case 'pose-key':
                if (e)
                    ctx.change(() => {
                        const at = Math.round(ctx.time * ctx.project.fps) / ctx.project.fps;
                        const old = e.poseKeys.find(k => Math.abs(k.time - at) < 1e-6);
                        if (old)
                            old.pose = clone(samplePose(e, ctx.time));
                        else
                            e.poseKeys.push({ time: at, pose: clone(samplePose(e, ctx.time)) });
                        e.poseKeys.sort((a, b) => a.time - b.time);
                    }, false);
                break;
            case 'seek-key':
                if (e)
                    ctx.seek(e.poseKeys[Number(el.dataset.index)].time);
                ctx.renderInspector();
                break;
            case 'delete-key':
                if (e)
                    ctx.change(() => { e.poseKeys.splice(Number(el.dataset.index), 1); }, false);
                break;
            case 'preview-selected':
                if (e?.kind === 'camera') {
                    ctx.preview = e.id;
                    ctx.renderCameras();
                    ctx.setView('shot');
                }
                break;
            case 'cut-selected':
                if (e?.kind === 'camera') {
                    if(ctx.change(() => { ctx.project.duration=Math.max(ctx.project.duration,ctx.time+1); addCut(ctx.project, ctx.time, e.id); }, false)) ctx.toast(`已在 ${ctx.time.toFixed(2)} 秒切入 ${e.name}`);
                }
                break;
            case 'insert-cut':
                if (ctx.preview !== 'program')
                    ctx.change(() => { ctx.project.duration=Math.max(ctx.project.duration,ctx.time+1); addCut(ctx.project, ctx.time, ctx.preview); }, false);
                break;
            case 'delete-cut':
                selectClip(null);
                if (Number(el.dataset.index) > 0)
                    ctx.change(() => { ctx.project.cuts.splice(Number(el.dataset.index), 1); }, false);
                break;
            case 'visibility':
                ctx.change(() => { const item = ctx.project.entities.find(x => x.id === el.dataset.id)!; item.visible = !item.visible; }, false);
                break;
            case 'duplicate':
                if (e)
                    ctx.change(() => { const copy = clone(e); copy.id = uid(); copy.locked = false; copy.name += ' 副本'; copy.clips.forEach(c => c.id = uid()); if(copy.structureLink)copy.structureLink=null; if (copy.handBinding) copy.handBinding.offset[0] += .1; else shiftPath(copy, new T.Vector3(.4, 0, .4)); ctx.project.entities.push(copy); ctx.selected = copy.id; });
                break;
            case 'ground-selected':
                if (e?.handBinding) { ctx.toast('手持道具请先解除绑定，再对齐地面'); break; }
                if (e && e.kind !== 'camera' && !['ground', 'road'].includes(e.asset))
                    ctx.change(() => {
                        const bounds = new T.Box3().setFromObject(ctx.engine.models.get(e.id)!);
                        if (!bounds.isEmpty()) shiftPath(e, new T.Vector3(0, -bounds.min.y, 0));
                    }, false);
                break;
            case 'unlock-selected':
                if (e) ctx.change(() => { e.locked = false; }, false);
                break;
            case 'delete':
                if (e)
                    ctx.deleteDialog(e);
                break;
            case 'confirm-delete':
                ctx.deleteEntity(el.dataset.id!, ($('#replacement-camera') as HTMLSelectElement | null)?.value);
                break;
            case 'seat':
                ctx.seatDialog();
                break;
            case 'seat-apply':
                ctx.seatApply();
                break;
            case 'snapshot':
                await ctx.snapshot();
                break;
            case 'export':
                ctx.playing = false;
                ctx.exportDialog();
                break;
            case 'export-start':
                await ctx.startExport();
                break;
            case 'cancel-export':
                ctx.aborter?.abort();
                break;
            case 'close-modal':
                ctx.closeModal();
                break;
            case 'apply-room':
                if(ctx.change(() => { ctx.project.room = { enabled: $<HTMLInputElement>('#room-enabled').checked, width: Number($<HTMLInputElement>('#room-width').value), depth: Number($<HTMLInputElement>('#room-depth').value), height: Number($<HTMLInputElement>('#room-height').value) }; })) ctx.closeModal();
                break;
            case 'rename-project':
                if(ctx.change(() => { ctx.project.name = $<HTMLInputElement>('#rename-input').value; }, false)) ctx.closeModal();
                break;
            case 'help':
                ctx.helpDialog();
                break;
        }
    }
    return { act };
}
