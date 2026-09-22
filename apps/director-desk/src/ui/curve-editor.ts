import type { AppContext } from '../app-context.ts';
import { curveTargets, insertCurvePause } from '../animation/curve-targets.ts';
import { eased, EASINGS, type Easing } from '../animation/channels.ts';
import { options } from './common.ts';
import { easingChoice, easingChoices } from './easing-options.ts';
import './curve-editor.css';

export function createCurveEditor(ctx: AppContext, refresh = () => ctx.renderInspector()) {
    let owner = '', channel = 'path', index = 1;
    let handleObserver: ResizeObserver | undefined;
    const target = () => { const e = ctx.current(); return e && curveTargets(e).find(t => t.id === channel); };
    function graph(easing: Easing = 'linear') {
        const controls = typeof easing === 'object' ? easing.bezier : easing === 'ease-in' ? [.55, 0, 1, 1] : easing === 'ease-out' ? [0, 0, .45, 1] : easing === 'linear' ? [.33, .33, .67, .67] : [.33, 0, .67, 1];
        const [a, b, c, d] = controls, x = (v: number) => 24 + v * 252, y = (v: number) => 150 - v * 126;
        const points = Array.from({ length: 101 }, (_, i) => `${x(i / 100)},${y(eased(i / 100, easing))}`).join(' ');
        return `<svg id="curve-graph" viewBox="0 0 300 180" aria-label="横轴时间、纵轴进度；拖动两个控制柄调节速度"><path class="curve-grid" d="M24 24V150H276 M24 87H276 M150 24V150"/><text x="24" y="14">进度</text><text x="248" y="172">时间</text><path class="curve-tangent" d="M24 150L${x(a)} ${y(b)} M276 24L${x(c)} ${y(d)}"/><polyline class="curve-line" points="${points}"/>${[[a, b], [c, d]].map(([cx, cy], i) => `<ellipse data-curve-handle="${i}" cx="${x(cx)}" cy="${y(cy)}" rx="7" ry="7" tabindex="0" role="slider" aria-label="控制柄 ${i + 1}，方向键微调" aria-valuetext="${cx.toFixed(2)}, ${cy.toFixed(2)}"/>`).join('')}</svg>`;
    }
    function commit(value: Easing, expectedOwner = owner, expectedChannel = channel, expectedIndex = index) {
        const e = ctx.current();
        if (!e || e.id !== expectedOwner || e.locked || channel !== expectedChannel || index !== expectedIndex) return;
        const curve = target(); if (!curve?.keys[index] || curve.sampleContinuous) return;
        ctx.change(() => { curve.keys[index].easing = value; }, false);
    }
    function render() {
        const e = ctx.current(); if (!e) return '';
        const curves = curveTargets(e);
        if (owner !== e.id) { owner = e.id; channel = curves[0]?.id ?? 'path'; index = 1; }
        if (!curves.some(t => t.id === channel)) channel = curves[0]?.id ?? 'path';
        const curve = target();
        if (!curve) return '<p class="panel-help">先在路径或镜头／灯光参数中记录至少两个关键帧，再调整它们之间的速度曲线。</p>';
        index = Math.max(1, Math.min(index, curve.keys.length - 1));
        const value = curve.keys[index].easing;
        if (curve.sampleContinuous) {
            const a = curve.keys[index - 1].time, b = curve.keys[index].time;
            let previous = curve.sampleContinuous(a), distance = 0;
            const lengths = [0];
            for (let i = 1; i <= 100; i++) { const next = curve.sampleContinuous(a + (b - a) * i / 100); distance += previous.distanceTo(next); lengths.push(distance); previous = next; }
            const points = lengths.map((length, i) => (24 + i * 2.52) + ',' + (150 - (distance ? length / distance : 0) * 126)).join(' ');
            return '<div class="curve-editor"><select id="curve-channel" aria-label="曲线参数">' + options(curves.map(t => [t.id, t.label]), channel) + '</select><select id="curve-segment" aria-label="关键帧区间">' + options(curve.keys.slice(1).map((k, i) => [String(i + 1), (i + 1) + " → " + (i + 2) + " · " + curve.keys[i].time.toFixed(2) + "—" + k.time.toFixed(2) + " 秒"]), String(index)) + '</select><div id="curve-canvas"><svg id="curve-graph" viewBox="0 0 300 180" aria-label="连贯运动实际路程进度，只读"><path class="curve-grid" d="M24 24V150H276 M24 87H276 M150 24V150"/><text x="24" y="14">路程进度</text><text x="248" y="172">时间</text><polyline class="curve-line" points="' + points + '"/></svg></div><small>连贯运动：此图显示实际路程进度。调整途经点时间改变快慢，选择经过或停住控制衔接；分段贝塞尔编辑请切回分段曲线。</small></div>';
        }
        return `<div class="curve-editor"><select id="curve-channel" aria-label="曲线参数">${options(curves.map(t => [t.id, t.label]), channel)}</select><select id="curve-segment" aria-label="关键帧区间">${options(curve.keys.slice(1).map((k, i) => [String(i + 1), `${i + 1} → ${i + 2} · ${curve.keys[i].time.toFixed(2)}—${k.time.toFixed(2)} 秒`]), String(index))}</select><div id="curve-canvas">${graph(value)}</div><select id="curve-preset" aria-label="速度预设">${options(easingChoices(value), easingChoice(value))}</select><small>${curve.repeated ? '源路径曲线，应用于所有排布片段。' : '线越陡变化越快；松手生效，可撤销。'} 同位置关键帧表示停留。</small></div>`;
    }
    function bind() {
        handleObserver?.disconnect();
        const root = document.querySelector<HTMLElement>('.curve-editor'); if (!root) return;
        const sizeHandles = () => {
            const matrix = root.querySelector('svg')?.getScreenCTM();
            if (!matrix || !matrix.a || !matrix.d) return;
            root.querySelectorAll('[data-curve-handle]').forEach(handle => {
                handle.setAttribute('rx', String(6 / Math.abs(matrix.a)));
                handle.setAttribute('ry', String(6 / Math.abs(matrix.d)));
            });
        };
        handleObserver = new ResizeObserver(sizeHandles); handleObserver.observe(root);
        sizeHandles();
        root.querySelector<HTMLSelectElement>('#curve-channel')!.onchange = event => { channel = (event.target as HTMLSelectElement).value; index = 1; refresh(); };
        root.querySelector<HTMLSelectElement>('#curve-segment')!.onchange = event => { index = Number((event.target as HTMLSelectElement).value); refresh(); };
        if (target()?.sampleContinuous) return;
        root.querySelector<HTMLSelectElement>('#curve-preset')!.onchange = event => { const value = (event.target as HTMLSelectElement).value; if (Object.hasOwn(EASINGS, value)) commit(value as Easing); };
        let drag: { id: number; handle: number; points: [number, number, number, number]; owner: string; channel: string; index: number; revision: number } | undefined;
        const getControls = (): [number, number, number, number] => {
            const circles = [...root.querySelectorAll<SVGEllipseElement>('[data-curve-handle]')];
            return circles.flatMap(c => [(Number(c.getAttribute('cx')) - 24) / 252, (150 - Number(c.getAttribute('cy'))) / 126]) as [number, number, number, number];
        };
        const paint = (points: [number, number, number, number]) => {
            const aspect = root.querySelector('svg')?.getAttribute('preserveAspectRatio');
            root.querySelector('#curve-canvas')!.innerHTML = graph({ bezier: points });
            if (aspect) root.querySelector('svg')!.setAttribute('preserveAspectRatio', aspect);
            sizeHandles();
        };
        root.onpointerdown = event => {
            const handle = (event.target as Element).closest<SVGEllipseElement>('[data-curve-handle]');
            if (!handle || event.button !== 0 || ctx.current()?.locked || ctx.busy || ctx.history.pending || ctx.draft) return;
            event.preventDefault(); event.stopPropagation();
            drag = { id: event.pointerId, handle: Number(handle.dataset.curveHandle), points: getControls(), owner, channel, index, revision: ctx.scenes.context.revision }; ctx.playing = false; root.tabIndex = -1; root.focus({ preventScroll: true }); root.setPointerCapture(event.pointerId);
        };
        root.onpointermove = event => {
            if (!drag || drag.id !== event.pointerId) return;
            const svg = root.querySelector<SVGSVGElement>('svg')!, matrix = svg.getScreenCTM(); if (!matrix) return;
            const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
            const clamp = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 1000) / 1000;
            drag.points[drag.handle * 2] = clamp((point.x - 24) / 252); drag.points[drag.handle * 2 + 1] = clamp((150 - point.y) / 126); paint(drag.points);
        };
        root.onpointerup = event => { if (!drag || drag.id !== event.pointerId) return; const edit = drag; drag = undefined; root.releasePointerCapture(event.pointerId); if (edit.revision !== ctx.scenes.context.revision) { ctx.toast('拖动期间工程已变化，请重新调整曲线'); refresh(); return; } commit({ bezier: edit.points }, edit.owner, edit.channel, edit.index); };
        root.onpointercancel = root.onlostpointercapture = () => { if (drag) { drag = undefined; refresh(); } };
        root.onkeydown = event => {
            if (event.key === 'Escape' && drag) { const id = drag.id; drag = undefined; root.releasePointerCapture(id); refresh(); return; }
            const handle = (event.target as Element).closest<SVGEllipseElement>('[data-curve-handle]');
            if (!handle || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
            event.preventDefault(); event.stopPropagation(); const points = getControls(), axis = ['ArrowLeft', 'ArrowRight'].includes(event.key) ? 0 : 1;
            const at = Number(handle.dataset.curveHandle) * 2 + axis; points[at] = Math.max(0, Math.min(1, points[at] + (['ArrowRight', 'ArrowUp'].includes(event.key) ? .01 : -.01))); commit({ bezier: points }); document.querySelector<SVGEllipseElement>(`[data-curve-handle="${handle.dataset.curveHandle}"]`)?.focus();
        };
    }
    return { render, bind, footer() {
        const curve = target(), disabled = !curve || curve.repeated ? 'disabled' : '';
        return `<button data-act="curve-start" ${disabled}>区间起点</button><button data-act="curve-end" ${disabled}>区间终点</button><button data-act="curve-pause" ${disabled} title="在区间起点停留 1 秒，本通道后续关键帧顺延；其他轨道不变">起点停留 1 秒</button>`;
    }, handle(action: string) {
        if (!action.startsWith('curve-')) return false;
        const curve = target(), e = ctx.current(); if (!curve || !e || curve.repeated) return true;
        if (action === 'curve-pause') { if (!e.locked) ctx.change(() => { ctx.project.duration = Math.max(ctx.project.duration, insertCurvePause(e, channel, index)); }, false); }
        else { ctx.playing = false; ctx.seek(curve.keys[action === 'curve-start' ? index - 1 : index].time); document.querySelector<HTMLButtonElement>('#timeline-center')?.click(); }
        return true;
    } };
}
