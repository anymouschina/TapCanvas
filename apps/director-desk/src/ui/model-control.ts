import { Vector3 } from 'three';
import type { AppContext } from '../app-context.ts';
import { assertProject, type Vec3 } from '../model.ts';
import { assertLockedEntitiesUnchanged } from '../editor/invariants.ts';
import { ModelRecording, canRecordActions, recordingError, type RecordingAction } from '../editor/model-recording.ts';
import { extendTimelineView } from './timeline-zoom.ts';
import { escape } from './common.ts';
import './model-control.css';

export function mountModelControl(ctx: AppContext) {
    const trigger = document.createElement('button');
    trigger.id = 'model-control-open'; trigger.className = 'subtle'; trigger.textContent = '操控录制';
    document.querySelector('.key-tools')!.append(trigger);
    const canvas = ctx.engine.editorRenderer.domElement;
    const panel = document.createElement('section'); panel.id = 'model-control'; panel.hidden = true;
    panel.setAttribute('aria-label', '白模操控录制'); document.body.append(panel);
    const keys = new Set<string>(), movementKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'KeyF', 'ShiftLeft', 'ShiftRight']);
    let take: ModelRecording | null = null, raf = 0, previous = 0, accumulator = 0, lastUI = 0, paused = false;
    let targetId = '', oldMode = '', oldPan = true, oldPicking = true, oldCamera = new Vector3(), oldTarget = new Vector3();
    let inertElements: { element: HTMLElement; inert: boolean }[] = [];
    const find = <T extends HTMLElement>(id: string) => panel.querySelector<T>(`#${id}`)!;
    function open() {
        if (ctx.busy || ctx.history.pending || ctx.draft || ctx.engine.exporting) { ctx.toast('请先完成当前编辑或导出'); return; }
        const e = ctx.current(), error = recordingError(e); if (error) { ctx.toast(error, true); return; }
        targetId = e!.id; ctx.playing = false; ctx.updateTimeUI();
        if (ctx.mode === 'shot') ctx.setView('split');
        panel.classList.remove('recording');
        panel.innerHTML = `<div class="model-control-title"><strong>${escape(e!.name)} · 操控录制</strong><button id="model-control-close" aria-label="关闭操控录制">×</button></div>
            <p>从 ${ctx.time.toFixed(2)} 秒起重录后续走位${canRecordActions(e!) ? '与所选动作' : ''}，结束后可撤销。</p>
            <div class="model-control-options"><label>动作<select id="model-control-action"><option value="auto">自动走 / 跑 / 待机</option><option value="crawl">爬行</option><option value="keep">仅位移 · 保留原动作</option></select></label></div>
            <p>WASD 移动 · Shift 跑动 · R/F 升降 · 鼠标拖动观察<br>空格暂停 / 继续 · Enter 完成 · Esc 取消。高度手动控制，不自动避障。</p>
            <div class="model-control-buttons"><button id="model-control-start" class="primary">开始录制</button><button id="model-control-pause" hidden>暂停</button><button id="model-control-finish" hidden>完成</button><button id="model-control-cancel" hidden>取消</button></div>
            <output id="model-control-status" aria-live="polite">准备就绪</output>`;
        if (!canRecordActions(e!)) { find<HTMLSelectElement>('model-control-action').value = 'keep'; find<HTMLSelectElement>('model-control-action').disabled = true; }
        panel.hidden = false;
        find('model-control-close').onclick = () => { if (take) finish(false); else panel.hidden = true; };
        find('model-control-start').onclick = start;
        find('model-control-pause').onclick = () => togglePause();
        find('model-control-finish').onclick = () => finish(true);
        find('model-control-cancel').onclick = () => finish(false);
    }
    function start() {
        if (take || ctx.busy || ctx.history.pending || ctx.draft || ctx.engine.exporting) return;
        const e = ctx.current();
        if (e?.id !== targetId) { panel.hidden = true; ctx.toast('选中对象已变化，请重新打开操控录制'); return; }
        try {
            const candidate = new ModelRecording(e, ctx.time, ctx.project.fps, find<HTMLSelectElement>('model-control-action').value as RecordingAction);
            ctx.history.begin(ctx.project); take = candidate; ctx.busy = true; ctx.playing = false;
            oldMode = ctx.mode; oldCamera.copy(ctx.engine.editorCamera.position); oldTarget.copy(ctx.engine.orbit.target); oldPan = ctx.engine.orbit.enablePan;
            oldPicking = ctx.engine.pickingEnabled; ctx.engine.pickingEnabled = false;
            ctx.engine.selectedPoint = -1;
            ctx.engine.gizmo.detach(); ctx.engine.orbit.enablePan = false;
            ctx.project.entities[ctx.project.entities.findIndex(x => x.id === targetId)] = take.entity;
            ctx.engine.project = ctx.project; ctx.engine.sample(take.start);
            ctx.engine.focus(targetId); ctx.engine.orbit.update();
            // The stage and recording controls stay interactive; all other editing waits for this transaction.
            inertElements = [...document.querySelectorAll<HTMLElement>('.topbar,.sidebar,.inspector,.timeline,.view-toolbar,.monitor-strip,.statusbar,#object-labels,#ai-panel,#ai-launcher')]
                .map(element => ({ element, inert: element.inert }));
            inertElements.forEach(({ element }) => element.inert = true);
            panel.querySelector('.model-control-options')!.setAttribute('hidden', '');
            panel.classList.add('recording');
            find('model-control-start').hidden = true;
            for (const id of ['pause', 'finish', 'cancel']) find(`model-control-${id}`).hidden = false;
            paused = false; accumulator = 0; lastUI = 0; keys.clear(); previous = performance.now(); canvas.focus();
            raf = requestAnimationFrame(frame);
        } catch (error) { if (take) finish(false); ctx.toast((error as Error).message, true); }
    }
    function togglePause(focus = true) {
        if (!take) return;
        paused = !paused; keys.clear(); accumulator = 0; previous = performance.now();
        find('model-control-pause').textContent = paused ? '继续' : '暂停';
        find('model-control-status').textContent = `${paused ? '已暂停' : '录制中'} · ${take.time.toFixed(2)} 秒`;
        if (focus) canvas.focus();
    }
    function frame(now: number) {
        if (!take) return;
        try {
            // A hidden tab or a long stalled frame must not invent seconds of unobserved movement.
            const elapsed = (now - previous) / 1000; previous = now;
            if (elapsed > .5 && !paused) togglePause();
            if (!paused) {
                accumulator += Math.max(0, elapsed);
                const forward = ctx.engine.orbit.target.clone().sub(ctx.engine.editorCamera.position).toArray() as Vec3;
                const before = new Vector3(...take.position);
                while (accumulator + 1e-9 >= 1 / take.fps) { take.advance(keys, forward); accumulator -= 1 / take.fps; }
                const delta = new Vector3(...take.position).sub(before);
                ctx.engine.editorCamera.position.add(delta); ctx.engine.orbit.target.add(delta);
                ctx.time = take.time;
                ctx.project.duration = Math.max(ctx.project.duration, take.time);
            }
            ctx.engine.sample(Math.max(take.start, ctx.time - 1e-8)); ctx.engine.render();
            if (now - lastUI > 100) {
                document.querySelector<HTMLInputElement>('#duration')!.value = String(ctx.project.duration);
                document.querySelector('#duration-label')!.textContent = `${ctx.project.duration.toFixed(1)} s`;
                extendTimelineView(ctx, take.time);
                ctx.updateTimeUI(); find('model-control-status').textContent = `${paused ? '已暂停' : '录制中'} · ${take.time.toFixed(2)} 秒`;
                lastUI = now;
            }
            raf = requestAnimationFrame(frame);
        } catch (error) { finish(false); ctx.toast(`录制已取消：${(error as Error).message}`, true); }
    }
    function finish(save: boolean) {
        if (!take) return;
        const recording = take; take = null; cancelAnimationFrame(raf); keys.clear();
        let committed = false;
        try {
            if (save && recording.hasFrames) {
                ctx.project.duration = Math.max(ctx.project.duration, recording.time);
                assertLockedEntitiesUnchanged(ctx.history.pending!, ctx.project); assertProject(ctx.project);
                ctx.engine.externalModels.assertReady(ctx.project); ctx.history.commit(ctx.project); committed = true;
            } else ctx.project = ctx.history.rollback() ?? ctx.project;
        } catch (error) { ctx.project = ctx.history.rollback() ?? ctx.project; ctx.toast((error as Error).message, true); }
        finally {
            ctx.busy = false; ctx.playing = false; ctx.time = recording.start;
            inertElements.forEach(({ element, inert }) => element.inert = inert); inertElements = [];
            ctx.engine.orbit.enablePan = oldPan;
            ctx.engine.pickingEnabled = oldPicking;
            ctx.engine.editorCamera.position.copy(oldCamera); ctx.engine.orbit.target.copy(oldTarget); ctx.engine.orbit.update();
            panel.hidden = true; ctx.engine.project = ctx.project; ctx.engine.sample(ctx.time);
            ctx.setView(oldMode); ctx.engine.select(ctx.selected);
            if (committed) ctx.changed(false); else { ctx.engine.refreshHelpers(); ctx.renderPanels(); }
            extendTimelineView(ctx, Math.max(ctx.project.duration, recording.time));
            ctx.toast(committed ? `已录制 ${(recording.time - recording.start).toFixed(2)} 秒，播放可回看；Ctrl+Z 撤销` : '已取消录制，原走位保留');
        }
    }
    trigger.addEventListener('click', open);
    // Capture keys before the editor's shortcuts and ignore typing into unrelated inputs.
    document.addEventListener('keydown', event => {
        if (!take && !panel.hidden && event.code === 'Escape') { panel.hidden = true; return; }
        if (!take || (event.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName))) return;
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (!movementKeys.has(event.code) && !['Space', 'Enter', 'Escape'].includes(event.code)) return;
        event.preventDefault(); event.stopImmediatePropagation();
        if (event.code === 'Escape') finish(false);
        else if (event.code === 'Enter') finish(true);
        else if (event.code === 'Space') { if (!event.repeat) togglePause(); }
        else if (!paused) keys.add(event.code);
    }, true);
    document.addEventListener('keyup', event => keys.delete(event.code), true);
    const suspend = () => { keys.clear(); if (take && !paused) togglePause(false); };
    window.addEventListener('blur', suspend);
    document.addEventListener('visibilitychange', () => { if (document.hidden) suspend(); });
}
