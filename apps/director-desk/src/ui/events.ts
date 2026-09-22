import { setSelectedEntities, selectedEntities } from '../editor/timeline-selection.ts';
import { prepareDocumentModels } from '../scenes/document-models.ts';
import { bindTimelineInput } from './timeline-input.ts';
import * as T from 'three';
import type { AppContext } from '../app-context.ts';
import type { Action, Joint, Vec3 } from '../model.ts';
import { clip } from '../model.ts';
import { readRecoverableDocument } from './resource-recovery-panel.ts';
import { samplePose } from '../timeline.ts';
import { $ } from '../ui/common.ts';
export function bindEvents(ctx: AppContext) {
    document.addEventListener('click', event => {
        const target = event.target as HTMLElement;
        const action = target.closest<HTMLElement>('[data-act]');
        if (action) {
            event.stopPropagation();
            void ctx.act(action.dataset.act!, action);
            return;
        }
        if (ctx.busy)
            return;
        const creation = target.closest<HTMLElement>('[data-creation-mode]');
        if (creation) {
            ctx.change(() => { ctx.project.creationMode = creation.dataset.creationMode as 'full' | 'geometry'; ctx.assetFilter = '全部'; ctx.query = ''; }, false);
            $<HTMLInputElement>('#search').value = ctx.query; return;
        }
        const side = target.closest<HTMLElement>('[data-side]');
        if (side) {
            ctx.sidebarTab = side.dataset.side!;
            ctx.query = '';
            $<HTMLInputElement>('#search').value = '';
            $<HTMLInputElement>('#search').placeholder = ctx.sidebarTab === 'assets' ? '搜索白模资产' : '搜索场景对象';
            ctx.renderSidebar();
            return;
        }
        const asset = target.closest<HTMLElement>('[data-asset]');
        if (asset) {
            ctx.addAsset(asset.dataset.asset!);
            return;
        }
        const row = target.closest<HTMLElement>('[data-select]');
        if (row) {
            const id=row.dataset.select!;
            if(event.ctrlKey||event.metaKey){const ids=selectedEntities();setSelectedEntities(ids.includes(id)?ids.filter(x=>x!==id):[...ids,id]);}else setSelectedEntities([id]);
            ctx.selectEntity(row.dataset.select!,true);
            return;
        }
        const tab = target.closest<HTMLElement>('[data-inspect]');
        if (tab) {
            ctx.inspectorTab = tab.dataset.inspect!;
            ctx.renderInspector();
            return;
        }
        const view = target.closest<HTMLElement>('.view-modes button[data-view]');
        if (view) {
            ctx.setView(view.dataset.view!);
            return;
        }
        const cam = target.closest<HTMLElement>('[data-preview]');
        if (cam) {
            ctx.preview = cam.dataset.preview!;
            ctx.renderCameras();
            return;
        }
        const addAction = target.closest<HTMLElement>('[data-add-action]');
        if (addAction) {
            const e = ctx.current();
            if (e)
                ctx.change(() => {
                    let start = ctx.time;
                    for (const c of [...e.clips].sort((a, b) => a.start - b.start))
                        if (c.start < start + 3 && c.end > start)
                            start = c.end;
                    e.clips.push(clip(addAction.dataset.addAction as Action, start, start + 3));
                    ctx.extendDuration();
                }, false);
            return;
        }
        const framing = target.closest<HTMLElement>('[data-framing]');
        if (framing) {
            ctx.applyFraming(framing.dataset.framing!);
            return;
        }
        const motion = target.closest<HTMLElement>('[data-motion]');
        if (motion) {
            ctx.applyMotion(motion.dataset.motion!);
            return;
        }
        const range = target.closest<HTMLElement>('[data-range]');
        if (range) {
            const all = range.dataset.range === 'all';
            $<HTMLInputElement>('#export-start').value = String(all ? 0 : ctx.time);
            $<HTMLInputElement>('#export-end').value = String(all ? ctx.project.duration : Math.min(ctx.project.duration, ctx.time + Number(range.dataset.range)));
            ctx.updateExportSummary();
        }
    });
    document.addEventListener('change', async (event) => {
        const target = event.target as HTMLInputElement;
        if (ctx.busy)
            return;
        if (target.id==='position-edit-mode') {
            ctx.engine.positionKeying=target.value==='key';ctx.engine.select(ctx.selected,-1);ctx.renderInspector();return;
        }
        if (target.id === 'path-surface-mode') {
            ctx.engine.pathSurfaceMode = target.value as 'surface' | 'ground';
            if (ctx.draft) $('#stage-hint').textContent = target.value === 'surface' ? '点击台阶、平台或地面添加路线点 · Enter 完成 · Esc 取消' : '按地面平面画路线 · Enter 完成 · Esc 取消';
            return;
        }
        if (ctx.draft || ctx.history.pending) { ctx.toast('请先完成或取消当前绘制／拖动操作'); ctx.renderInspector(); return; }
        if (target.id === 'reference-labels') {
            const enabled = target.checked;
            ctx.change(() => { ctx.project.referenceLabels = enabled; }, false);
            return;
        }
        if (target.dataset.field) {
            ctx.applyField(target.dataset.field, target.value);
            return;
        }
        const e = ctx.current();
        if (target.dataset.point !== undefined && e?.path) {
            ctx.change(() => {
                const point = e.path!.points[Number(target.dataset.point)];
                if (target.dataset.axis === 'time')
                    point.time = Number(target.value);
                else
                    point.position[Number(target.dataset.axis)] = Number(target.value);
                ctx.extendDuration();
            }, false);
            return;
        }
        if (target.dataset.clip && e) {
            ctx.change(() => { const c = e.clips.find(c => c.id === target.dataset.clip)!; c[target.dataset.prop as 'start' | 'end' | 'speed'] = Number(target.value); ctx.extendDuration(); }, false);
            return;
        }
        if (target.dataset.joint && e) {
            ctx.change(() => {
                const joint = target.dataset.joint as Joint;
                if (e.poseKeys.length) {
                    const at = Math.round(ctx.time * ctx.project.fps) / ctx.project.fps;
                    const pose = samplePose(e, ctx.time);
                    pose[joint] = Number(target.value);
                    const key = e.poseKeys.find(k => Math.abs(k.time - at) < 1e-6);
                    if (key)
                        key.pose = pose;
                    else
                        e.poseKeys.push({ time: at, pose });
                    e.poseKeys.sort((a, b) => a.time - b.time);
                }
                else
                    e.pose[joint] = Number(target.value);
            }, false);
            return;
        }
        if (target.dataset.wall && e?.camera) {
            ctx.change(() => {
                const walls = e.camera!.hideWalls.filter(w => w !== target.dataset.wall);
                if (target.checked)
                    walls.push(target.dataset.wall!);
                e.camera!.hideWalls = walls;
            }, false);
            return;
        }
        if (target.id === 'aspect') {
            ctx.change(() => ctx.project.aspect = target.value, false);
            ctx.engine.requestResize();
            return;
        }
        if (target.id === 'fps') {
            ctx.change(() => ctx.project.fps = Number(target.value), false);
            return;
        }
        if (target.id === 'monitor-camera') { ctx.preview = target.value; ctx.renderCameras(); return; }
        if (target.id === 'placement-snap') { ctx.engine.setPlacementSnap(Number(target.value)); return; }
        if (target.id === 'object-snap') { ctx.engine.setObjectSnap(target.checked); return; }
        if (target.id === 'duration') {
            ctx.change(() => {
                const duration = Number(target.value);
                if (ctx.project.cuts.some(c => c.time >= duration && c.time > 0))
                    throw new Error('结束时间处或之后还有切镜，请先调整切镜边界');
                ctx.project.duration = duration;
                ctx.time = Math.min(ctx.time, duration);
            }, false);
            return;
        }
        if (target.id.startsWith('export-')) {
            ctx.updateExportSummary();
            return;
        }
        if (target.id === 'project-file' && target.files?.[0]) {
            ctx.busy = true; ctx.playing = false; ctx.updateTimeUI();
            try {
                const original = ctx.project, checkpoint = JSON.stringify(original), sceneContext = ctx.scenes.context;
                const p = await readRecoverableDocument(ctx, JSON.parse(await target.files[0].text()));
                await prepareDocumentModels(ctx.engine.externalModels, p);
                if (ctx.draft || ctx.history.pending || ctx.project !== original || JSON.stringify(ctx.project) !== checkpoint)
                    throw new Error('读取期间工程或操作状态已改变，请结束当前操作后重新导入');
                ctx.busy = false; ctx.applyDocument(p, sceneContext, '打开工程', true);
                ctx.toast('项目已导入，可以继续编辑');
            }
            catch (error) {
                ctx.toast((error as Error).message, true);
            }
            finally { ctx.busy = false; ctx.engine.externalModels.retain([ctx.project, ...ctx.history.undoStack, ...ctx.history.redoStack]); ctx.updateTimeUI(); }
            target.value = '';
            return;
        }

    });
    document.addEventListener('input', event => {
        const target = event.target as HTMLInputElement;
        if (ctx.busy)
            return;
        if (target.id === 'search') {
            ctx.query = target.value;
            ctx.renderSidebar();
        }
        if (target.dataset.joint) {
            const output = target.parentElement!.querySelector('output');
            if (output)
                output.textContent = target.value + '°';
        }
        if (target.id.startsWith('export-'))
            ctx.updateExportSummary();
    });
    document.addEventListener('keydown', event => {
        if (ctx.busy)
            return;
        const input = event.target as HTMLElement;
        if (input.closest('#ai-panel')) return;
        if (event.key === 'Escape' && input.closest('#modal-root') && input.tagName !== 'SELECT') {
            event.preventDefault(); ctx.closeModal(); return;
        }
        const selectShortcut = input.tagName === 'SELECT' && !event.altKey && (event.ctrlKey || event.metaKey) && ['s', 'z'].includes(event.key.toLowerCase());
        if (['INPUT', 'SELECT', 'TEXTAREA'].includes(input.tagName) && !selectShortcut)
            return;
        if (event.key === 'Escape') {
            if (ctx.draft)
                ctx.cancelPath();
            else
                ctx.closeModal();
            return;
        }
        if ($('#modal-root').children.length)
            return;
        if (event.key === 'Enter' && ctx.draft) {
            ctx.finishPath();
            return;
        }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
            event.preventDefault();
            ctx.saveProject();
            return;
        }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
            event.preventDefault();
            void ctx.act(event.shiftKey ? 'redo' : 'undo', document.body);
            return;
        }
        if ((event.ctrlKey || event.metaKey) && event.code === 'KeyD') {
            event.preventDefault(); void ctx.act('duplicate', document.body); return;
        }
        if(event.code==='KeyK' && !event.ctrlKey && !event.metaKey && !event.altKey){event.preventDefault();void ctx.act('position-key',document.body);return;}
        if (event.code === 'Space') {
            event.preventDefault();
            void ctx.act('play', document.body);
        }
        if (event.code === 'Digit1')
            void ctx.act('translate', document.body);
        if (event.code === 'Digit2')
            void ctx.act('rotate', document.body);
        if (event.code === 'Digit3')
            void ctx.act('scale', document.body);
        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            ctx.playing = false;
            ctx.seek(ctx.time - 1 / ctx.project.fps);
        }
        if (event.key === 'ArrowRight') {
            event.preventDefault();
            ctx.playing = false;
            ctx.seek(ctx.time + 1 / ctx.project.fps);
        }
        if (event.key === 'Delete')
            void ctx.act('delete', document.body);
        if (event.key === '/') {
            event.preventDefault();
            $('#search').focus();
        }
    });
    document.addEventListener('dragstart', event => {
        const asset = (event.target as HTMLElement).closest<HTMLElement>('[data-asset]');
        if (asset)
            event.dataTransfer?.setData('application/x-director-asset', asset.dataset.asset!);
    });
    $('#stage-canvas').addEventListener('dragover', event => { event.preventDefault(); });
    $('#stage-canvas').addEventListener('drop', event => {
        event.preventDefault();
        if (ctx.busy)
            return;
        const id = event.dataTransfer?.getData('application/x-director-asset');
        if (!id)
            return;
        const rect = ctx.engine.editorRenderer.domElement.getBoundingClientRect(), ray = new T.Raycaster();
        ray.setFromCamera(new T.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), ctx.engine.editorCamera);
        const point = new T.Vector3();
        if (ray.ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), 0), point))
            ctx.addAsset(id, point.toArray() as Vec3);
    });
    bindTimelineInput(ctx);
}
