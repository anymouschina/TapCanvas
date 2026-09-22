import { CAMERA_PRESETS, applyCameraMotion } from '../cinematography/motion-presets.ts';
import { setEntityColor } from './entity-color.ts';
import { worldContactAnchors } from '../assets/contact-anchors.ts';
import { removeCameraVisibilityReference } from '../scenes/camera-visibility.ts';
import { seatedPlacement } from './seat-placement.ts';
import { detachHandBinding } from '../animation/hand-binding.ts';
import { disconnectStructure } from '../building/structure-links.ts';
import { workingElevation } from '../building/floors.ts';
import { sliceAction } from '../clip-editing.ts';
import { recordPositionKey } from './position-keys.ts';
import { propParameters } from '../parametric-props.ts';
import * as T from 'three';
import type { AppContext } from '../app-context.ts';
import { ASSETS } from '../asset-catalog.ts';
import type { Action, Entity, Vec3 } from '../model.ts';
import { COLORS, clip, entity } from '../model.ts';
import { entityPosition, shiftPath } from '../timeline.ts';
import { $ } from '../ui/common.ts';
import { freezeCamera } from './camera-editing.ts';
import { libraryPreferences } from '../assets/library-preferences.ts';
export function createEditingTools(ctx: AppContext) {
    function addAsset(id: string, position?: Vec3) {
        const asset = ASSETS.find(a => a.id === id);
        if (!asset)
            return;
        const added = ctx.change(() => {
            const target = ctx.engine.orbit.target;
            const e = entity(asset.kind, asset.id, asset.name, ctx.engine.snapPosition(position ?? [target.x, workingElevation(ctx.project), target.z]));
            if (!position) e.position[1] = workingElevation(ctx.project);
            if (e.light && !position) { e.position[1] += 3; e.rotation[0] = -Math.PI / 4; }
            if (ctx.project.editorView?.activeFloorId) e.floorId = ctx.project.editorView.activeFloorId;
            if (asset.kind === 'actor' || asset.kind === 'crowd') {
                e.color = COLORS[ctx.project.entities.filter(x => x.kind === 'actor').length % COLORS.length];
                e.clips = [clip('idle', 0, ctx.project.duration)];
            }
            ctx.project.entities.push(e);
            ctx.selected = e.id;
            ctx.inspectorTab = e.light ? 'light' : 'base';
        });
        if (added) libraryPreferences.used(id);
        ctx.engine.select(ctx.selected);
    }
    function makeCamera(fromView = false) {
        ctx.change(() => {
            const cameras = ctx.project.entities.filter(e => e.kind === 'camera');
            const pos = (fromView ? ctx.engine.editorCamera.position.clone() : new T.Vector3(1.8, 1.5 + workingElevation(ctx.project), 1.8)).toArray() as Vec3;
            const e = entity('camera', 'camera', String.fromCharCode(65 + cameras.length) + ' · 新机位', pos);
            if (ctx.project.editorView?.activeFloorId) { e.floorId = ctx.project.editorView.activeFloorId; e.camera!.target[1] += workingElevation(ctx.project); }
            if (fromView) {
                e.camera!.target = ctx.engine.orbit.target.toArray() as Vec3;
                const referenceCam = ctx.engine.editorCamera.clone();
                referenceCam.filmGauge = 36;
                e.camera!.focal = T.MathUtils.clamp(referenceCam.getFocalLength(), 8, 300);
            }
            ctx.project.entities.push(e);
            ctx.selected = e.id;
            ctx.inspectorTab = 'camera';
            ctx.preview = e.id;
        });
        ctx.engine.select(ctx.selected);
    }
    function startPath() {
        const e = ctx.current();
        if (!e || e.locked)
            return;
        if (e.handBinding) { ctx.toast('手持道具请先解除绑定，再绘制独立路径'); return; }
        if (e.structureLink || ctx.project.entities.some(child => child.structureLink?.parentId === e.id)) { ctx.toast('请先解除该模块的上下游连接，再绘制独立路径'); return; }
        ctx.playing = false;
        ctx.history.begin(ctx.project);
        if (e.camera?.mode !== 'free' && e.camera) freezeCamera(ctx.engine, e);
        ctx.draft = { id: e.id };
        e.path = { smooth: ctx.engine.pathSurfaceMode === 'ground', points: [{ time: ctx.time, position: entityPosition(e, ctx.time).toArray() as Vec3 }] };
        ctx.engine.drawingPath = true;
        ctx.engine.gizmo.detach();
        ctx.setView('stage');
        $('#stage-hint').textContent = ctx.engine.pathSurfaceMode === 'surface' ? '点击台阶、平台或地面添加路线点 · Enter 完成 · Esc 取消' : '按地面平面画路线 · Enter 完成 · Esc 取消';
        ctx.engine.refreshHelpers();
        ctx.renderInspector();
    }
    function addGroundPoint(position: Vec3) {
        if (!ctx.draft)
            return;
        const e = ctx.project.entities.find(e => e.id === ctx.draft!.id)!;
        if (e.kind === 'camera')
            position[1] += e.path!.points[0].position[1];
        if (ctx.engine.pathSurfaceMode === 'ground') position = ctx.engine.snapPosition(position);
        e.path!.points.push({ time: e.path!.points.at(-1)!.time + 2, position });
        ctx.engine.refreshHelpers();
        ctx.renderInspector();
    }
    function finishPath() {
        if (!ctx.draft)
            return;
        const e = ctx.project.entities.find(e => e.id === ctx.draft!.id)!;
        if (e.path!.points.length < 2) {
            cancelPath();
            ctx.toast('至少添加一个终点，才能形成路线');
            return;
        }
        ctx.draft = null;
        ctx.engine.drawingPath = false;
        ctx.extendDuration();
        ctx.history.commit(ctx.project);
        ctx.changed(false);
        ctx.engine.select(ctx.selected);
        $('#stage-hint').textContent = '点击布景启用键盘 · WASD 移动 · QE 转向 · RF 升降';
    }
    function cancelPath() {
        if (!ctx.draft)
            return;
        ctx.project = ctx.history.rollback() ?? ctx.project;
        ctx.selected = ctx.history.restoredSelection || ctx.selected;
        ctx.engine.selected = ctx.selected;
        ctx.draft = null;
        ctx.engine.drawingPath = false;
        ctx.engine.rebuild(ctx.project);
        ctx.renderPanels();
        $('#stage-hint').textContent = '点击布景启用键盘 · WASD 移动 · QE 转向 · RF 升降';
    }
    function replaceAction(e: Entity, action: Action, start: number, end: number) {
        if(end<=start)throw Error('需要两个不同时间的位置点才能匹配动作');
        const retained = [];
        for (const c of e.clips) {
            if (c.end <= start || c.start >= end)
                retained.push(c);
            else {
                if (c.start < start)
                    retained.push(sliceAction(c,c.start,start,false));
                if (c.end > end)
                    retained.push(sliceAction(c,end,c.end));
            }
        }
        e.clips = [...retained, clip(action, start, end)].sort((a, b) => a.start - b.start);
    }
    function retimePath(e: Entity, start: number, end: number) {
        const p = e.path;
        if (!p)
            return;
        const oldStart = p.points[0].time, oldEnd = p.points.at(-1)!.time;
        if (p.points.length===1)throw Error('单个位置关键帧请直接修改途经点时间');
        if (end <= start)
            throw new Error('结束时间必须晚于开始时间');
        const matching = e.clips.find(c => Math.abs(c.start - oldStart) < 1e-6 && Math.abs(c.end - oldEnd) < 1e-6 && ['walk', 'run'].includes(c.action));
        p.sections?.forEach(s => {
            const map=(t:number)=>start+(t-oldStart)/(oldEnd-oldStart)*(end-start);
            s.start=map(s.start); s.end=map(s.end); s.from=map(s.from); s.to=map(s.to);
        });
        p.points.forEach(w => w.time = start + (w.time - oldStart) / (oldEnd - oldStart) * (end - start));
        if (matching) {
            matching.start = start;
            matching.end = end;
        }
        ctx.extendDuration();
    }
    function mutateField(key: string, value: string) {
        const e = ctx.current();
        if (!e || e.locked && key !== 'locked')
            return;
        const n = Number(value);
        if (key === 'name')
            e.name = value;
        else if (key === 'color')
            setEntityColor(e, value);
        else if (key === 'external.appearance' && e.external) e.external.appearance = value as 'original' | 'white' | 'color';
        else if (key === 'external.unitScale' && e.external) {
            if (e.kind === 'actor') e.height *= n / e.external.unitScale;
            e.external.unitScale = n;
        }
        else if (key.startsWith('external.orientation.') && e.external) e.external.orientation[Number(key.split('.')[2])] = T.MathUtils.degToRad(n);
        else if (key.startsWith('assetParameters.')) {
            e.assetParameters ??= {};
            e.assetParameters[key.slice('assetParameters.'.length)] = n;
        }
        else if (key.startsWith('parameters.')) {
            e.parameters ??= propParameters(e);
            const name=key.slice(11) as keyof NonNullable<Entity['parameters']>;
            Object.assign(e.parameters,{[name]:name==='layout'?value:n});
        }
        else if (key === 'footContact') e.footContact=value==='true';
        else if (key === 'actionBlend') e.actionBlend=n;
        else if (key.startsWith('handOffset.') && e.handBinding) e.handBinding.offset[Number(key.split('.')[1])] = n;
        else if (key.startsWith('handRotation.') && e.handBinding) e.handBinding.rotation[Number(key.split('.')[1])] = T.MathUtils.degToRad(n);
        else if (key === 'height')
            e.height = n;
        else if (key === 'build')
            e.build = value as Entity['build'];
        else if (key === 'locked')
            e.locked = value === 'true';
        else if (key === 'count')
            e.count = n;
        else if (key === 'spacing')
            e.spacing = n;
        else if (key === 'seed')
            e.seed = n;
        else if (key === 'face')
            e.face = value as Entity['face'];
        else if (key === 'faceTarget')
            e.faceTarget = value;
        else if (key.startsWith('pos.')) {
            if (e.camera && e.camera.mode !== 'free') freezeCamera(ctx.engine, e);
            const axis = Number(key.split('.')[1]), d = new T.Vector3();
            d.setComponent(axis, n - entityPosition(e, ctx.time).getComponent(axis));
            if(ctx.engine.positionKeying && !e.structureLink) recordPositionKey(e,ctx.time,entityPosition(e,ctx.time).add(d).toArray() as Vec3,ctx.project.fps);
            else shiftPath(e, d);
            ctx.extendDuration();
        }
        else if (key.startsWith('rot.')) {
            if (e.camera) {
                if (e.camera.mode !== 'free') freezeCamera(ctx.engine, e);
                const r = ctx.engine.cameras.get(e.id)!.rotation;
                e.rotation = [r.x, r.y, r.z];
                e.camera.aim = 'manual';
                e.camera.mode = 'free';
            }
            e.rotation[Number(key.split('.')[1])] = T.MathUtils.degToRad(n);
        }
        else if (key.startsWith('scale.'))
            e.scale[Number(key.split('.')[1])] = n;
        else if (key === 'path-start' && e.path)
            retimePath(e, n, e.path.points.at(-1)!.time);
        else if (key === 'path-end' && e.path)
            retimePath(e, e.path.points[0].time, n);
        else if (key === 'path-smooth' && e.path)
            e.path.smooth = value === 'true';
        else if (key.startsWith('target.') && e.camera)
            e.camera.target[Number(key.split('.')[1])] = n;
        else if (key.startsWith('offset.') && e.camera)
            e.camera.offset[Number(key.split('.')[1])] = n;
        else if (key.startsWith('camera.') && e.camera) {
            const c = e.camera;
            switch (key.slice(7)) {
                case 'aim':
                    if (value === 'manual') {
                        const camera = ctx.engine.cameras.get(e.id)!, base = camera.userData.directorBasePose;
                        const r = base ? new T.Euler().setFromQuaternion(new T.Quaternion().fromArray(base.quaternion)) : camera.rotation;
                        e.rotation = [r.x, r.y, r.z];
                    }
                    c.aim = value as typeof c.aim;
                    break;
                case 'focal':
                    c.focal = n;
                    if (c.effects) { delete c.effects.channels?.focal; c.effects.dollyZoom = null; }
                    break;
                case 'targetHeight':
                    c.targetHeight = n;
                    break;
                case 'aimResponse.duration':
                    if (c.mode === 'pov' || c.mode === 'free' && c.aim !== 'target') break;
                    if (!Number.isFinite(n) || n < 0 || n > 2) throw new Error('目标响应时长应在 0 到 2 秒之间');
                    if (n === 0) delete c.aimResponse;
                    else c.aimResponse = { duration: n };
                    break;
                case 'targetId':
                    if (!value && c.mode !== 'free') freezeCamera(ctx.engine, e);
                    c.targetId = value;
                    break;
                case 'mode':
                    if (value === c.mode) break;
                    if (value === 'free') { freezeCamera(ctx.engine, e); break; }
                    if (value !== 'free' && !c.targetId)
                        c.targetId = ctx.project.entities.find(t => t.kind === 'actor')?.id ?? ctx.project.entities.find(t => t.kind !== 'camera')?.id ?? '';
                    if (!c.targetId) throw new Error('先添加人物或道具，再设置跟随／POV');
                    c.mode = value as typeof c.mode;
                    if (value === 'pov')
                        c.offset = [0, 1.67, .13];
                    if (value === 'follow')
                        c.offset = [0, 1.5, -2];
                    break;
                case 'inheritRotation':
                    c.inheritRotation = value === 'true';
                    break;
            }
        }
    }
    function applyField(key: string, value: string) {
        const e = ctx.current(); if (!e || e.locked && key !== 'locked') return;
        ctx.change(() => mutateField(key, value), key.startsWith('parameters.') || key.startsWith('assetParameters.') || ['color','gender','count','spacing','seed'].includes(key)
            || e.kind==='crowd' && ['height','build'].includes(key));
    }
    function deleteEntity(id: string, replacement?: string) {
        if(ctx.change(() => {
            for (const prop of ctx.project.entities) if (prop.handBinding?.actorId === id) detachHandBinding(prop, ctx.engine.models.get(prop.id)!);
            for (const child of ctx.project.entities) if (child.structureLink?.parentId === id) disconnectStructure(child);
            removeCameraVisibilityReference(ctx.project, id);
            ctx.project.entities = ctx.project.entities.filter(e => e.id !== id);
            if (ctx.project.editorView) ctx.project.editorView.hiddenEntityIds = ctx.project.editorView.hiddenEntityIds.filter(entityId => entityId !== id);
            ctx.project.production?.notes.forEach(note => { if (note.actorId === id) note.actorId = ''; });
            ctx.project.cuts.forEach(c => {
                if (c.cameraId === id)
                    c.cameraId = replacement!;
            });
            ctx.project.entities.forEach(e => {
                if (e.camera?.targetId === id) {
                    freezeCamera(ctx.engine, e);
                    e.camera.targetId = '';
                    e.camera.mode = 'free';
                }
                if (e.faceTarget === id) {
                    e.faceTarget = '';
                    e.face = 'fixed';
                }
            });
            ctx.selected = ctx.project.entities.find(e => e.kind === 'actor')?.id ?? ctx.project.entities[0].id;
            ctx.preview = 'program';
        })) ctx.closeModal();
    }
    function seatApply() {
        const e = ctx.current(); if (!e) return;
        if (ctx.change(() => {
            const [targetId, anchorId] = JSON.parse($<HTMLSelectElement>('#seat-target').value) as [string, string];
            const target = ctx.project.entities.find(e => e.id === targetId); if (!target) throw Error('座位对象已不存在');
            const anchor = worldContactAnchors(target, ctx.engine.models.get(target.id)!).find(a => a.id === anchorId); if (!anchor) throw Error('座面接触点已不存在');
            const placement = seatedPlacement(e, anchor);
            e.position = placement.position; e.rotation[1] = placement.yaw; e.face = 'fixed'; e.faceTarget = ''; e.path = null; e.pose = {}; e.poseKeys = []; e.clips = [];
            replaceAction(e, 'sit', 0, ctx.project.duration);
        }, false)) ctx.closeModal();
    }
    function applyMotion(name: string) {
        const e = ctx.current();
        if (e?.kind !== 'camera')
            return;
        const applied=ctx.change(() => {
            if (e.camera!.mode !== 'free') freezeCamera(ctx.engine, e);
            const preset = Object.entries(CAMERA_PRESETS).find(([, label]) => label === name)?.[0];
            if (!preset) throw Error('未知运镜预设');
            applyCameraMotion(ctx.project, e.id, preset, Math.round(ctx.time * ctx.project.fps) / ctx.project.fps, 5);
            ctx.extendDuration();
        }, false);
        if(!applied)return;
        ctx.inspectorTab = 'path';
        ctx.renderInspector();
        ctx.toast('运镜预设已生成，可编辑路径和时间');
    }
    function applyFraming(name: string) {
        const e = ctx.current();
        if (e?.kind !== 'camera')
            return;
        const target=ctx.project.entities.find(t=>t.id===e.camera!.targetId)||ctx.project.entities.find(t=>t.kind==='actor');
        if(!target){ctx.toast('先选择一个构图目标或添加人物');return;}
        ctx.change(() => { if (e.camera!.effects) { delete e.camera!.effects.channels?.focal; e.camera!.effects.dollyZoom = null; } e.camera!.targetPath = null; e.camera!.aim = 'target'; e.camera!.targetId = target.id; const heights: Record<string, number> = { '全景': 2.2, '中景': 1.15, '近景': .65, '特写': .3 }; const h = heights[name], targetY = name === '全景' ? target.height * .5 : name === '中景' ? target.height * .67 : target.height * .88; e.camera!.targetHeight = targetY; e.camera!.mode = 'free'; e.camera!.focal = name === '特写' ? 70 : 35; const cam = ctx.engine.getShotCamera(e.id); const aspect = ctx.project.aspect.split(':').map(Number); const filmHeight = 36 / Math.max(aspect[0] / aspect[1], 1); const distance = h * e.camera!.focal / filmHeight; const targetPos = entityPosition(target, ctx.time).add(new T.Vector3(0, targetY, 0)); const direction = cam.position.clone().sub(targetPos).normalize(); e.position = targetPos.addScaledVector(direction, distance).toArray() as Vec3; e.path = null; }, false);
        ctx.preview = e.id;
        ctx.renderCameras();
        ctx.toast('已调整机位与焦距；请检查室内墙体遮挡');
    }
    return { addAsset, makeCamera, startPath, addGroundPoint, finishPath, cancelPath, replaceAction, retimePath, applyField, mutateField, deleteEntity, seatApply, applyMotion, applyFraming };
}
