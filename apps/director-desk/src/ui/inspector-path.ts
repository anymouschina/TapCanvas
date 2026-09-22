import { easingChoice, easingChoices, chosenEasing } from './easing-options.ts';
import type { AppContext } from '../app-context.ts';
import type { Entity } from '../model.ts';
import { button, num, options, select } from './common.ts';
import type { InspectorNavigation } from './inspector-navigation.ts';
import { continuousMotionHelp, pathMotionChoices, setPathMotionMode, waypointMotionChoices, waypointMotionValue } from './path-motion-controls.ts';

export function createPathInspector(ctx: AppContext, navigation: InspectorNavigation, refresh: () => void) {
    let previousOwner = '', previousPoint = -1, sectionIndex = 0;
    const content = document.querySelector<HTMLElement>('#inspector-content')!;
    content.addEventListener('change', event => {
        const input = event.target as HTMLSelectElement;
        if (['path-interpolation', 'path-point-stop', 'path-point-easing'].includes(input.id)) {
            event.stopPropagation();
            const e = ctx.current(); if (!e?.path || e.locked || ctx.busy) return;
            if (ctx.draft || ctx.history.pending) { ctx.toast('请先完成或取消当前绘制／拖动操作'); refresh(); return; }
            const point = e.path.points[Math.max(0, Math.min(e.path.points.length - 1, ctx.engine.selectedPoint))];
            if (input.id === 'path-interpolation') ctx.change(() => setPathMotionMode(e.path!, input.value), false);
            else if (input.id === 'path-point-stop' && e.path.interpolation === 'continuous') ctx.change(() => { point.stop = input.value === 'stop'; }, false);
            else if (input.id === 'path-point-easing' && e.path.interpolation !== 'continuous') ctx.change(() => { point.easing = chosenEasing(input.value, point.easing); }, false);
            refresh(); return;
        }
        if (input.id === 'path-section-choice') { event.stopPropagation(); sectionIndex = Number(input.value); refresh(); return; }
        if (input.id !== 'path-point-choice') return;
        event.stopPropagation(); ctx.engine.select(ctx.selected, Number(input.value)); refresh();
    });
    content.addEventListener('click', event => {
        const hold = (event.target as HTMLElement).closest('[data-act="hold-point"]');
        if (hold) {
            const choice = content.querySelector<HTMLSelectElement>('#path-point-choice');
            if (choice) ctx.engine.select(ctx.selected, Number(choice.value));
        }
        const control = (event.target as HTMLElement).closest<HTMLElement>('[data-step-point]');
        if (!control) return;
        event.stopPropagation();
        const path = ctx.current()?.path; if (!path) return;
        const index = Math.max(0, ctx.engine.selectedPoint);
        ctx.engine.select(ctx.selected, Math.max(0, Math.min(path.points.length - 1, index + Number(control.dataset.stepPoint)))); refresh();
    });
    return { render(e: Entity, human: boolean) {
        const path = e.path, key = `${e.id}:path`;
        if (e.handBinding) return '<p class="panel-help">道具全段跟随人物手部。到“手持”解除绑定后，可设置独立路径。</p>';
        if (e.structureLink || ctx.project.entities.some(child => child.structureLink?.parentId === e.id)) return '<p class="panel-help">此模块参与建筑连接。先在“结构”解除上下游连接，再设置路径。</p>';
        const draw = `<label class="field"><span>绘制落点</span><select id="path-surface-mode">${options([['surface', '物体表面 · 保留高度'], ['ground', '仅地面 · Y = 0']], ctx.engine.pathSurfaceMode)}</select></label>`
            + (ctx.draft ? '<div class="drawing-banner">正在画路线 · 点击场景添加途经点</div>' : `<div class="button-row">${button('draw-path', path ? '重画路线' : '画路线', 'plus')}${path ? button('clear-path', '清除', 'trash', 'subtle') : ''}</div>`)
            + button('position-key', '记录当前位置 · K', '', 'wide subtle')
            + '<p class="panel-help">可点选楼梯、平台等表面。开启“位置关键帧”后移动对象，即记录位置关键帧。</p>';
        if (!path) return draw;
        const index = Math.max(0, Math.min(path.points.length - 1, ctx.engine.selectedPoint)), p = path.points[index];
        if (previousOwner !== e.id || previousPoint !== ctx.engine.selectedPoint && ctx.engine.selectedPoint >= 0) navigation.select(key, 'points');
        previousOwner = e.id; previousPoint = ctx.engine.selectedPoint;
        const frozen = path.sections ? 'disabled' : '', continuous = path.interpolation === 'continuous';
        const points = `<div class="inspector-picker point-picker"><button data-step-point="-1" aria-label="上一个途经点" ${index === 0 ? 'disabled' : ''}>‹</button><select id="path-point-choice" aria-label="选择途经点">${options(path.points.map((point, i) => [String(i), `途经点 ${i + 1} / ${path.points.length} · ${point.time.toFixed(2)} 秒`]), String(index))}</select><button data-step-point="1" aria-label="下一个途经点" ${index === path.points.length - 1 ? 'disabled' : ''}>›</button><button class="icon-button" data-act="remove-point" data-index="${index}" ${frozen} title="删除此途经点" aria-label="删除此途经点">×</button></div>`
            + `<div class="waypoint single-waypoint"><div class="point-coords"><label class="point-time"><span>时间 / 秒</span><input type="number" data-point="${index}" data-axis="time" ${frozen} value="${p.time.toFixed(2)}" step=".1" min="0"/></label>${p.position.map((v, axis) => `<label>${['X', 'Y', 'Z'][axis]} / 米<input type="number" data-point="${index}" data-axis="${axis}" value="${v.toFixed(2)}" step=".05"/></label>`).join('')}</div></div>`
            + `<div class="field-pair"><label class="field"><span title="${continuousMotionHelp}">运动方式 ⓘ</span><select id="path-interpolation" title="${continuousMotionHelp}">${options(pathMotionChoices, path.interpolation ?? 'segmented')}</select></label>`
            + (continuous
                ? `<label class="field"><span>此点运动</span><select id="path-point-stop" title="经过：连续通过此点；停住：到此点速度降为零。端点选择经过可保留进出镜速度。">${options(waypointMotionChoices, waypointMotionValue(path.points, index))}</select></label>`
                : `<label class="field"><span>到达此点的速度变化</span><select id="path-point-easing" ${index === 0 ? 'disabled' : ''}>${options(easingChoices(p.easing), easingChoice(p.easing))}</select></label>`)
            + '</div>'
            + `<div class="button-row">${button('append-point', '添加点', 'plus', 'subtle', frozen)}${button('hold-point', '停留 1 秒', '', 'subtle', frozen)}</div>`;
        const timing = (path.points.length > 1 ? `<div class="field-pair">${num('开始 / 秒', 'path-start', path.points[0].time, '.1', 'min="0" ' + frozen)}${num('结束 / 秒', 'path-end', path.points.at(-1)!.time, '.1', 'min="0" ' + frozen)}</div>` : '')
            + (continuous ? '' : select('路线形状', 'path-smooth', [['true', '平滑曲线'], ['false', '直线 / 途经停顿']], String(path.smooth)))
            + button('surface-open', '检查承托面 / 校正高度', '', 'wide subtle');
        const facing = select('身体朝向', 'face', [['path', '沿路线前进'], ['fixed', '保持设定朝向'], ['target', '面向指定对象']], e.face)
            + (e.face === 'target' ? select('面向目标', 'faceTarget', [['', '选择对象'], ...ctx.project.entities.filter(t => t.id !== e.id).map(t => [t.id, t.name] as [string, string])], e.faceTarget) : '')
            + (human && path.points.length > 1 ? `<div class="section-label">匹配整条路径动作</div><div class="button-row">${button('path-walk', '走路', '', 'subtle')}${button('path-run', '跑步', '', 'subtle')}</div>` : '');
        const sections = [{ id: 'points', label: '途经点', html: points }, { id: 'route', label: '路线', html: timing }, { id: 'draw', label: '绘制', html: draw }];
        if (!e.external && (e.kind === 'actor' || e.kind === 'crowd')) sections.push({ id: 'facing', label: '朝向', html: facing });
        if (path.sections) {
            sectionIndex = Math.max(0, Math.min(path.sections.length - 1, sectionIndex));
            sections.push({ id: 'segments', label: '片段', html: `<label class="field"><span>已排路径片段</span><select id="path-section-choice">${options(path.sections.map((s, i) => [String(i), `片段 ${i + 1} · ${s.start.toFixed(2)} — ${s.end.toFixed(2)} 秒`]), String(sectionIndex))}</select></label><button class="wide subtle" data-edit-path-section="${sectionIndex}" data-owner="${e.id}">编辑此片段时间</button><p class="panel-help">各片段共用此路线的途经点。也可在时间轴双击片段编辑。</p>` });
        }
        return navigation.render(key, sections);
    } };
}
