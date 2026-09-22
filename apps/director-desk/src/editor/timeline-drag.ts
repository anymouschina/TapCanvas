import type { Project } from '../model.ts';
import { clipRange, dragClipRange, type TimelineSelection } from '../clip-editing.ts';

/** Reset only the edited timing values; never copy scene resources on pointer movement. */
export function createTimelineDrag(project:Project, selection:TimelineSelection) {
    const duration=project.duration, range={...clipRange(project,selection)};
    const cuts=selection.kind==='cut'?project.cuts.map(c=>({...c})):null;
    const entity=selection.kind==='cut'?undefined:project.entities.find(e=>e.id===selection.entityId)!;
    const action=selection.kind==='action'?entity!.clips.find(c=>c.id===selection.id):undefined;
    const path=selection.kind==='path'?entity!.path:undefined;
    const section=selection.kind==='path'?path?.sections?.[selection.index]:undefined;
    const times=path&&!section?path.points.map(p=>p.time):undefined;
    const reset=()=>{
        project.duration=duration;
        if(cuts)project.cuts=cuts.map(c=>({...c}));
        if(action)Object.assign(action,{start:range.start,end:range.end});
        if(section)Object.assign(section,{start:range.start,end:range.end});
        if(times)path!.points.forEach((p,i)=>p.time=times[i]);
    };
    return {apply(delta:number,resize:boolean){reset();try{return dragClipRange(project,selection,delta,resize);}catch(error){reset();throw error;}}};
}
