import * as T from 'three';
import type { AppContext } from '../app-context.ts';
import type { Entity, Vec3 } from '../model.ts';
import { recordCameraLook } from '../animation/camera-look.ts';
import { options } from './common.ts';
import { continuousMotionHelp, pathMotionChoices, setPathMotionMode, waypointMotionChoices, waypointMotionValue } from './path-motion-controls.ts';
import './native-animation-editor.css';

export function createCameraLookPanel(ctx: AppContext) {
    let index = 0, owner = '', draftInterpolation: 'continuous' | undefined, draftSmooth = true;
    const input = (id: string) => document.getElementById(id) as HTMLInputElement;
    const current = () => ctx.project.entities.find(e => e.id === owner);
    const readonly = (e: Entity) => e.locked || e.camera?.mode === 'pov';
    function motionFields(e: Entity) {
        const path = e.camera!.targetPath, disabled = readonly(e) ? 'disabled' : '';
        return (path?.interpolation ?? draftInterpolation) === 'continuous'
            ? `<label>此点运动<select id="look-stop" ${disabled}>${options(waypointMotionChoices, waypointMotionValue(path?.points ?? [], index))}</select></label>`
            : `<label>分段过渡<select id="look-smooth" ${disabled}>${options([['true', '平滑起止'], ['false', '匀速移动注视点']], String(path?.smooth ?? draftSmooth))}</select></label>`;
    }
    function refreshMotionFields() {
        const e = current(); if (!e?.camera) return;
        input('look-interpolation').value = e.camera.targetPath?.interpolation ?? draftInterpolation ?? 'segmented';
        document.getElementById('look-motion-fields')!.innerHTML = motionFields(e);
    }
    function canEdit(e: Entity) {
        if (ctx.busy) return false;
        if (readonly(e)) { ctx.toast('请先解锁摄影机，并使用独立或跟随机位'); return false; }
        if (ctx.draft || ctx.history.pending) { ctx.toast('请先完成或取消当前绘制／拖动操作'); return false; }
        return true;
    }
    function render() {
        const e = current(), c = e?.camera;
        if (!e || !c) return;
        const points = c.targetPath?.points ?? [];
        index = Math.max(0, Math.min(index, points.length - 1));
        draftInterpolation = c.targetPath?.interpolation; draftSmooth = c.targetPath?.smooth ?? true;
        const point = points[index], at = point?.time ?? ctx.time, position = point?.position ?? ctx.engine.targetPosition(e).toArray();
        const disabled = readonly(e) ? 'disabled' : '';
        ctx.showModal('摄影机 · 视线关键帧', `<div class="native-editor" id="look-editor">
            <p class="panel-help">机位沿原路径移动，视线按这些世界坐标过渡。取对象位置只记录该时刻坐标，不持续绑定对象。首帧前与末帧后保持端点；POV 使用绑定朝向。</p>
            <label>关键帧<select id="look-choice">${options(points.length ? points.map((p, i) => [String(i), `${i + 1} · ${p.time.toFixed(2)} 秒`]) : [['0', '尚未记录']], String(index))}</select></label>
            <div class="native-values"><label>时间 / 秒<input id="look-time" type="number" min="0" step=".1" value="${at.toFixed(3)}" ${disabled}/></label><label>视线运动<select id="look-interpolation" ${disabled}>${options(pathMotionChoices, draftInterpolation ?? 'segmented')}</select></label></div>
            <div id="look-motion-fields">${motionFields(e)}</div>
            <p class="panel-help">${continuousMotionHelp}端点选择经过可保留进出镜速度。</p>
            <div class="native-values">${position.map((v, axis) => `<label>${'XYZ'[axis]} / 米<input id="look-${axis}" type="number" step=".1" value="${v.toFixed(3)}" ${disabled}/></label>`).join('')}</div>
            <div class="native-row"><label>取对象当前位置<select id="look-source" ${disabled}>${options([['', '当前机位注视点'], ...ctx.project.entities.filter(t => t.kind !== 'camera').map(t => [t.id, t.name] as [string, string])], '')}</select></label><button data-act="look-capture" ${disabled}>取当前帧</button></div>
            <div class="look-key-actions"><button data-act="look-save" ${disabled}>保存为关键帧</button><button data-act="look-seek" ${points.length ? '' : 'disabled'}>预览此帧</button><button data-act="look-remove" ${points.length ? disabled : 'disabled'}>删除此帧</button></div>
            <p class="panel-help">同一帧再次保存会更新该点。改变时间会新增一个点，原点保留。可多次记录相同坐标来停留。</p>
        </div>`, `<button data-act="look-clear" ${disabled}>清除视线关键帧</button><button data-act="close-modal">关闭</button>`);
        document.getElementById('look-editor')!.addEventListener('change', event => {
            const target = event.target as HTMLSelectElement;
            if (target.id === 'look-choice') { event.stopPropagation(); index = Number(target.value); render(); return; }
            if (!['look-interpolation', 'look-stop', 'look-smooth'].includes(target.id)) return;
            event.stopPropagation();
            const entity = current(); if (!entity?.camera) return;
            if (!canEdit(entity)) { refreshMotionFields(); return; }
            const path = entity.camera.targetPath;
            if (target.id === 'look-interpolation') {
                draftInterpolation = target.value === 'continuous' ? 'continuous' : undefined;
                if (path) {
                    ctx.change(() => setPathMotionMode(path, target.value), false);
                    draftInterpolation = current()?.camera?.targetPath?.interpolation;
                }
                refreshMotionFields();
            } else if (target.id === 'look-stop' && path?.interpolation === 'continuous' && path.points[index]) {
                ctx.change(() => { path.points[index].stop = target.value === 'stop'; }, false); refreshMotionFields();
            } else if (target.id === 'look-smooth') {
                draftSmooth = target.value === 'true';
                if (path) ctx.change(() => { path.smooth = draftSmooth; }, false);
            }
        });
    }
    return { handle(action: string) {
        if (!['look-open', 'look-save', 'look-remove', 'look-clear', 'look-seek', 'look-capture'].includes(action)) return false;
        if (action === 'look-open') { owner = ctx.selected; index = 0; render(); return true; }
        const e = current(); if (!e?.camera) return true;
        if (action === 'look-seek') { ctx.seek(e.camera.targetPath?.points[index]?.time ?? ctx.time); return true; }
        if (!canEdit(e)) return true;
        if (action === 'look-capture') {
            const id = input('look-source').value, target = id ? ctx.engine.models.get(id) : null;
            const position = target ? target.getWorldPosition(new T.Vector3()).add(new T.Vector3(0, e.camera.targetHeight, 0)) : ctx.engine.targetPosition(e);
            position.toArray().forEach((v, axis) => { input(`look-${axis}`).value = v.toFixed(3); }); input('look-time').value = String(ctx.time);
            return true;
        }
        ctx.change(() => {
            const c = e.camera!;
            if (action === 'look-clear') { c.target = ctx.engine.targetPosition(e).toArray(); c.targetPath = null; }
            if (action === 'look-remove' && c.targetPath) { c.targetPath.points.splice(index, 1); if (!c.targetPath.points.length) c.targetPath = null; }
            if (action === 'look-save') {
                const mode = input('look-interpolation').value, stop = input('look-stop')?.value;
                c.targetPath = recordCameraLook(c.targetPath, Number(input('look-time').value), [0, 1, 2].map(i => Number(input(`look-${i}`).value)) as Vec3, ctx.project.fps);
                setPathMotionMode(c.targetPath, mode);
                if (mode !== 'continuous') c.targetPath.smooth = input('look-smooth').value === 'true';
                c.aim = 'target';
                index = c.targetPath.points.findIndex(p => Math.abs(p.time - Math.round(Number(input('look-time').value) * ctx.project.fps) / ctx.project.fps) < 1e-7);
                if (mode === 'continuous' && index >= 0) c.targetPath.points[index].stop = stop === 'stop';
                ctx.extendDuration();
            }
        }, false); render(); return true;
    } };
}
