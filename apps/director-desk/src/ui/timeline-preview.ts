import type { AppContext } from '../app-context.ts';
import { clipRange, type TimelineSelection } from '../clip-editing.ts';
import { extendTimelineView } from './timeline-zoom.ts';

export const timelineOffset=(time:number)=>`calc(var(--timeline-pps) * ${Math.max(0,time)})`;
/** Timing-only edits reuse mounted bars, labels and pointer targets. */
export function createTimelineDragPreview(ctx:AppContext,initial:TimelineSelection, manageHighlight=true, updateExtent=true) {
    const root=document.querySelector<HTMLElement>('#timeline-content')!;
    const cutBars=initial.kind==='cut'?[...root.querySelectorAll<HTMLElement>('[data-cut]')]:[];
    const names=new Map(ctx.project.entities.filter(e=>e.camera).map(e=>[e.id,e.name]));
    const selector=initial.kind==='action'?`[data-clip-id="${CSS.escape(initial.id)}"]`:initial.kind==='path'?`[data-path-id="${CSS.escape(initial.entityId)}"][data-section="${initial.index}"]`:null;
    const selectedBar=selector?root.querySelector<HTMLElement>(selector):null;
    let highlighted=root.querySelector<HTMLElement>('.clip-selected'),duration=ctx.project.duration;
    const last=root.querySelector<HTMLElement>(`[data-cut="${ctx.project.cuts.length-1}"]`);
    const end=root.querySelector<HTMLElement>('.timeline-end-line');
    const durationBars=[...root.querySelectorAll<HTMLElement>('.timeline-clip.idle,.timeline-clip.camera')];
    const set=(bar:HTMLElement,start:number,end:number)=>{bar.style.left=timelineOffset(start);bar.style.width=timelineOffset(end-start);};
    return (selection:TimelineSelection)=>{
    const range=clipRange(ctx.project,selection);
    if(updateExtent)extendTimelineView(ctx,Math.max(ctx.project.duration,range.end));
    const next=selection.kind==='cut'?cutBars[selection.index]:selectedBar;
    if(manageHighlight && highlighted!==next){highlighted?.classList.remove('clip-selected');next?.classList.add('clip-selected');highlighted=next;}
    if(selection.kind==='cut') {
        cutBars.forEach(bar=>{
            const i=Number(bar.dataset.cut),c=ctx.project.cuts[i];set(bar,c.time,ctx.project.cuts[i+1]?.time??ctx.project.duration);
            const label=bar.querySelector('span')!,name=names.get(c.cameraId)??'';
            if(label.textContent!==name)label.textContent=name;
            bar.title=`${name} · ${c.time}s`;
        });
    } else {
        const bar=selectedBar;
        if(bar){set(bar,range.start,range.end);bar.classList.add('clip-selected');if(selection.kind==='path')bar.querySelector('span')!.textContent=`${ctx.project.entities.find(e=>e.id===selection.entityId)?.camera?'运镜':'路径'} ${selection.index+1} · ${(range.end-range.start).toFixed(2)}s`;}
    }
    if(duration!==ctx.project.duration){
        duration=ctx.project.duration;
        if(last)last.style.width=timelineOffset(duration-ctx.project.cuts.at(-1)!.time);
        if(end){end.style.left=timelineOffset(duration);end.title=`场景结束 ${duration} 秒`;}
        durationBars.forEach(bar=>bar.style.width=timelineOffset(duration));
    }
    };
}
