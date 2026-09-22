import type { AppContext } from '../app-context.ts';
import { emptyEditorView } from '../building/floors.ts';

/** Track order is scene-local editor metadata, never the scene entity order. */
export function bindTrackOrder(ctx: AppContext) {
    const host = document.querySelector<HTMLElement>('#timeline-content')!;
    const rows = () => [...host.querySelectorAll<HTMLElement>('[data-track-key]')];
    const keys = () => rows().map(row => row.dataset.trackKey!);
    const save = (order: string[]) => ctx.change(() => {
        ctx.project.editorView ??= emptyEditorView();
        ctx.project.editorView.trackOrder = order;
    }, false);
    host.addEventListener('keydown', event => {
        const grip = (event.target as HTMLElement).closest<HTMLElement>('[data-track-grip]');
        if (!grip || !event.altKey || !['ArrowUp','ArrowDown'].includes(event.key) || ctx.busy || ctx.history.pending || ctx.draft) return;
        event.preventDefault(); event.stopPropagation();
        const row = grip.closest<HTMLElement>('[data-track-key]')!, order = keys(), from = order.indexOf(row.dataset.trackKey!);
        const to = from + (event.key === 'ArrowUp' ? -1 : 1);
        if (to < 0 || to >= order.length) return;
        [order[from],order[to]] = [order[to],order[from]]; save(order);
        host.querySelector<HTMLElement>(`[data-track-key="${CSS.escape(row.dataset.trackKey!)}"] [data-track-grip]`)?.focus();
    });
    host.addEventListener('pointerdown', event => {
        const grip = (event.target as HTMLElement).closest<HTMLElement>('[data-track-grip]');
        if (!grip || event.button !== 0 || ctx.busy || ctx.history.pending || ctx.draft) return;
        event.preventDefault(); event.stopImmediatePropagation();
        const row = grip.closest<HTMLElement>('[data-track-key]')!, before = keys(), project = ctx.project;
        const scene = ctx.scenes.context, startY = event.clientY, bounds = host.getBoundingClientRect(), initialScroll = host.scrollTop;
        const rowBounds = row.getBoundingClientRect(), offsetY = startY-rowBounds.top;
        const others = rows().filter(item=>item!==row).map(item=>({key:item.dataset.trackKey!,rect:item.getBoundingClientRect()}));
        const ghost = document.createElement('div'), marker = document.createElement('div');
        ghost.className='track-drag-ghost'; marker.className='track-drop-line';
        ghost.inert=true; ghost.setAttribute('aria-hidden','true'); marker.setAttribute('aria-hidden','true');
        const copy = row.cloneNode(true) as HTMLElement; copy.removeAttribute('data-track-key');
        copy.querySelectorAll('[id]').forEach(el=>el.removeAttribute('id'));
        copy.querySelectorAll('[data-track-grip]').forEach(el=>el.removeAttribute('data-track-grip'));
        copy.style.gridTemplateColumns=`${row.querySelector('.track-label')!.getBoundingClientRect().width}px minmax(0,1fr)`;
        copy.querySelectorAll<HTMLElement>('.track-lane > *').forEach(el=>el.style.translate=`${-host.scrollLeft}px 0`);
        ghost.append(copy); ghost.style.left=marker.style.left=bounds.left+'px';
        ghost.style.width=marker.style.width=host.clientWidth+'px'; ghost.style.height=rowBounds.height+'px';
        ghost.style.setProperty('--timeline-pps',getComputedStyle(host).getPropertyValue('--timeline-pps'));
        ghost.style.setProperty('--timeline-playhead',getComputedStyle(host).getPropertyValue('--timeline-playhead'));
        ghost.hidden=marker.hidden=true; document.body.append(ghost,marker);
        let y = startY, moved = false, frame = 0, finished = false, previous = performance.now(), destination=0;
        const top = bounds.top + 62, bottom = bounds.top + host.clientHeight;
        const update = () => {
            if (!moved) return;
            ghost.style.transform=`translateY(${y-offsetY}px)`;
            const scroll = host.scrollTop-initialScroll;
            let low=0,high=others.length;
            while(low<high){const mid=(low+high)>>>1,r=others[mid].rect;if(y<r.top+r.height/2-scroll)high=mid;else low=mid+1;}
            destination=low;
            const lineY=others[low]?.rect.top ?? others.at(-1)?.rect.bottom ?? rowBounds.top;
            marker.style.transform=`translateY(${Math.max(top,Math.min(bottom-2,lineY-scroll))}px)`;
        };
        const tick = (now: number) => {
            if (!row.isConnected || ctx.project !== project || ctx.busy) { finish(true); return; }
            const speed = y < top + 24 ? -Math.min(600,(top+24-y)*15) : y > bottom-24 ? Math.min(600,(y-bottom+24)*15) : 0;
            if (moved && speed) { host.scrollTop += speed * Math.min(.04,(now-previous)/1000); update(); }
            previous = now; frame = requestAnimationFrame(tick);
        };
        const move = (e: PointerEvent) => {
            if (e.pointerId !== event.pointerId) return;
            if (!e.buttons) { finish(); return; }
            y = e.clientY;
            if (!moved && Math.abs(y-startY)>2) { moved=true; row.classList.add('track-reordering'); host.dataset.trackReordering='true'; document.documentElement.dataset.trackReordering='true'; ghost.hidden=marker.hidden=false; }
            update();
        };
        const finish = (cancel = false) => {
            if (finished) return; finished = true; cancelAnimationFrame(frame);
            host.removeEventListener('pointermove',move); host.removeEventListener('pointerup',up); host.removeEventListener('pointercancel',cancelled); host.removeEventListener('lostpointercapture',cancelled);
            window.removeEventListener('blur',cancelled); window.removeEventListener('keydown',escape);
            window.removeEventListener('mouseup',mouseUp,true);
            if (host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId);
            delete host.dataset.trackReordering; delete document.documentElement.dataset.trackReordering; row.classList.remove('track-reordering'); ghost.remove(); marker.remove();
            const now = ctx.scenes.context;
            if (ctx.project !== project || now.sessionId !== scene.sessionId || now.sceneId !== scene.sceneId) return;
            const order = others.map(item=>item.key); order.splice(destination,0,row.dataset.trackKey!);
            if (!cancel && moved && order.join('\0') !== before.join('\0') && !ctx.history.pending && !ctx.busy) save(order);
            else if (moved) ctx.renderTimeline();
        };
        const up = (e: PointerEvent) => { if (e.pointerId === event.pointerId) finish(); };
        const cancelled = () => finish(true);
        const mouseUp = (event: MouseEvent) => { if(event.button===0)finish(); };
        const escape = (e: KeyboardEvent) => { if(e.key==='Escape'){e.preventDefault();e.stopPropagation();finish(true);} };
        host.setPointerCapture(event.pointerId);
        host.addEventListener('pointermove',move); host.addEventListener('pointerup',up); host.addEventListener('pointercancel',cancelled); host.addEventListener('lostpointercapture',cancelled);
        window.addEventListener('blur',cancelled); window.addEventListener('keydown',escape);
        window.addEventListener('mouseup',mouseUp,true);
        frame = requestAnimationFrame(tick);
    }, true);
    host.addEventListener('click', event => { if ((event.target as HTMLElement).closest('[data-track-grip]')) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
}
