import type { AppContext } from '../app-context.ts';
import { clipFromBar } from './clip-controls.ts';
import { clipSelected, selectedClips, selectedEntities, selectedTimeRange } from '../editor/timeline-selection.ts';
import './timeline-selection.css';

export function refreshTimelineSelection(ctx: AppContext, rangeOnly=false) {
    const root = document.querySelector<HTMLElement>('#timeline-content'); if (!root) return;
    if(!rangeOnly)root.querySelectorAll<HTMLElement>('[data-clip-id],[data-path-id],[data-cut]').forEach(bar => {
        const selected = clipSelected(clipFromBar(bar)); bar.classList.toggle('clip-selected', selected); bar.setAttribute('aria-selected', String(selected));
    });
    const entities = new Set(selectedEntities());
    document.querySelectorAll<HTMLElement>('[data-select]').forEach(row => row.classList.toggle('multi-selected', entities.has(row.dataset.select!)));
    const tracks = root.querySelector<HTMLElement>('.timeline-tracks');
    let overlay = root.querySelector<HTMLElement>('.timeline-selection-range');
    const range = selectedTimeRange();
    if (tracks && range) {
        if (!overlay) { overlay = document.createElement('div'); overlay.className = 'timeline-selection-range'; tracks.append(overlay); }
        const label = root.querySelector<HTMLElement>('.track-label')?.getBoundingClientRect().width ?? 0;
        overlay.style.left = `calc(${label}px + var(--timeline-pps) * ${range.start})`;
        overlay.style.width = `calc(var(--timeline-pps) * ${Math.max(0, range.end - range.start)})`;
        overlay.textContent = `${range.start.toFixed(2)}–${range.end.toFixed(2)}s`;
    } else overlay?.remove();
    const button = document.querySelector<HTMLElement>('#timeline-to-ai');
    if (button) { const count = selectedClips().length; button.textContent = count ? `交给 AI · ${count}` : range ? '时间范围 → AI' : '交给 AI'; }
    root.dispatchEvent(new CustomEvent('editor-selection-change', { detail: ctx.scenes?.context.sceneId }));
}
