import type { AppContext } from '../app-context.ts';
import { createCurveEditor } from './curve-editor.ts';

/** Curves share the existing edit transactions and sit below the scene time ruler. */
export function createTimelineCurves(ctx: AppContext) {
    const timeline = document.querySelector<HTMLElement>('.timeline')!;
    const host = document.querySelector<HTMLElement>('#timeline-curves')!;
    const curves = createCurveEditor(ctx, refresh);
    let showing = false;
    function refresh() {
        if (!showing) return;
        host.innerHTML = `<div class="timeline-curve-body">${curves.render() || '<p class="panel-help">选择对象后编辑关键帧区间曲线。</p>'}</div><div class="timeline-curve-actions">${curves.footer()}</div>`;
        curves.bind();
        const graph = host.querySelector<SVGSVGElement>('#curve-graph');
        graph?.setAttribute('preserveAspectRatio', 'none');
        host.querySelector('#curve-canvas')?.setAttribute('title', '横轴为所选区间的时间，纵轴为变化进度；连贯运动显示实际路程，上方时间尺仍定位整场戏。');
        if (ctx.current()?.locked) host.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('#curve-preset,[data-act="curve-pause"]').forEach(el => el.disabled = true);
    }
    function setMode(mode: string) {
        if (ctx.history.pending || ctx.draft) { ctx.toast('请先完成当前编辑'); return; }
        showing = mode === 'curves';
        timeline.classList.toggle('show-curves', showing);
        host.hidden = !showing;
        timeline.querySelectorAll<HTMLElement>('[data-timeline-view]').forEach(button => button.setAttribute('aria-pressed', String((button.dataset.timelineView === 'curves') === showing)));
        if (showing) refresh();
    }
    timeline.addEventListener('click', event => {
        const button = (event.target as HTMLElement).closest<HTMLElement>('[data-timeline-view]');
        if (button) { event.stopPropagation(); setMode(button.dataset.timelineView!); }
    });
    return { refresh, open: () => setMode('curves'), handle: (action: string) => showing && curves.handle(action) };
}
