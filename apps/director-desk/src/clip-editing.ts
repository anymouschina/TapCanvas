import { clone, uid, type Project, type MotionPath, type Clip } from './model.ts';
export type TimelineSelection = { kind:'action'; entityId:string; id:string } | { kind:'path'; entityId:string; index:number } | { kind:'cut'; index:number };
export function pathSections(path: MotionPath) { return path.sections ?? [{start:path.points[0].time,end:path.points.at(-1)!.time,from:path.points[0].time,to:path.points.at(-1)!.time}]; }
export function clipRange(p: Project, s: TimelineSelection) {
    const missing=()=>{throw Error('所选片段已不存在，请重新选择');};
    if (s.kind==='cut') {
        if(!Number.isInteger(s.index)||!p.cuts[s.index])return missing();
        return {start:p.cuts[s.index].time,end:p.cuts[s.index+1]?.time ?? p.duration};
    }
    const e=p.entities.find(e=>e.id===s.entityId);
    if(!e)return missing();
    if(s.kind==='action')return e.clips.find(c=>c.id===s.id)??missing();
    if(!e.path || !Number.isInteger(s.index))return missing();
    return pathSections(e.path)[s.index]??missing();
}
export function setClipRange(p:Project,s:TimelineSelection,start:number,end:number) {
    clipRange(p,s);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start<0 || end-start < 1/p.fps-1e-8) throw Error('片段至少需要一帧，开始时间不能小于零');
    if (s.kind==='cut') {
        if(s.index===0 && start!==0) throw Error('第一个镜头必须从 0 秒开始');
        if(s.index>0 && start-p.cuts[s.index-1].time<1/p.fps-1e-8) throw Error('开始时间必须晚于上一个切镜点');
        if(p.cuts[s.index+1] && (p.cuts[s.index+2]?.time ?? p.duration)-end<1/p.fps-1e-8) throw Error('请给后一个镜头至少保留一帧；也可以先延长后一个镜头');
        p.cuts[s.index].time=start;
        if(p.cuts[s.index+1]) p.cuts[s.index+1].time=end;
        else p.duration=end;
    } else {
        const e=p.entities.find(e=>e.id===s.entityId)!;
        if(e.locked) throw Error('对象已锁定');
        if(s.kind==='action') Object.assign(e.clips.find(c=>c.id===s.id)!,{start,end});
        else {
            const path=e.path!;
            if(path.sections) Object.assign(path.sections[s.index],{start,end});
            else {
                const a=path.points[0].time,b=path.points.at(-1)!.time;
                if(b===a)throw Error('单个位置关键帧请在路径面板修改时间');
                path.points.forEach(point=>point.time=start+(point.time-a)/(b-a)*(end-start));
            }
        }
        p.duration=Math.max(p.duration,end);
    }
}
/** Interactive dragging keeps a track valid without moving unrelated clips. */
export function dragClipRange(p:Project,s:TimelineSelection,delta:number,resize=false):TimelineSelection {
    const {start:a,end:b}=clipRange(p,s),frame=1/p.fps;
    if(!Number.isFinite(delta))throw Error('拖动时间无效');
    if(s.kind==='cut') {
        if(resize) {
            const shift=Math.max(a+frame,b+delta)-b;
            p.cuts.slice(s.index+1).forEach(c=>c.time+=shift);
            p.duration+=shift;
        } else {
            // Cuts form a continuous sequence: moving a shot inserts it elsewhere,
            // retaining every shot's duration instead of sliding its left boundary.
            const shots=p.cuts.map((cut,index)=>({cut,duration:(p.cuts[index+1]?.time??p.duration)-cut.time}));
            let index=s.index;
            if(delta>0)while(index<shots.length-1 && b+delta>(shots[index+1].cut.time+shots[index+1].duration/2))index++;
            else if(delta<0)while(index>0 && a+delta<(shots[index-1].cut.time+shots[index-1].duration/2))index--;
            if(index!==s.index) {
                const [shot]=shots.splice(s.index,1);shots.splice(index,0,shot);
                let time=0;
                p.cuts=shots.map(({cut,duration})=>{const next={...cut,time};time+=duration;return next;});
            }
            return {kind:'cut',index};
        }
        return s;
    }
    const e=p.entities.find(e=>e.id===s.entityId)!;
    const others=(s.kind==='action' ? e.clips.filter(c=>c.id!==s.id) : pathSections(e.path!).filter((_,i)=>i!==s.index))
        .slice().sort((x,y)=>x.start-y.start);
    if(resize) {
        // The right handle stops at the next clip; shifting other performances is a separate edit.
        const next=others.find(c=>c.start>=b-1e-8);
        setClipRange(p,s,a,Math.min(next?.start??Infinity,Math.max(a+frame,b+delta)));
    } else {
        let start=Math.max(0,a+delta); const duration=b-a;
        let end=start+duration;
        for(const c of others) {
            if(start>=c.end-1e-8){start=Math.max(start,c.end);end=start+duration;continue;}
            if(end<=c.start+1e-8){end=Math.min(end,c.start);break;}
            start=c.end;end=start+duration;
        }
        setClipRange(p,s,start,end);
    }
    return s;
}
/** Preserve the retained source interval when cutting or replacing part of an action. */
export function sliceAction(c:Clip,start:number,end:number,newId=true):Clip {
    if(start<c.start || end>c.end || end<=start)throw Error('动作保留区间无效');
    const dt=start-c.start;
    return {...clone(c),id:newId?uid():c.id,start,end,offset:(c.offset??0)+(c.retarget?.locomotion ? 0 : dt*c.speed),
        progressOffset:(c.progressOffset??0)+dt,sourceDuration:c.sourceDuration??c.end-c.start,
        turnAmount:end<c.end?0:c.turnAmount??1};
}
export function splitClip(p:Project,s:TimelineSelection,time:number):TimelineSelection {
    const {start,end}=clipRange(p,s), at=Math.round(time*p.fps)/p.fps;
    if(at-start<1/p.fps-1e-8 || end-at<1/p.fps-1e-8) throw Error('请把播放头移到所选片段内部，两侧至少留一帧');
    if(s.kind==='cut') { p.cuts.splice(s.index+1,0,{time:at,cameraId:p.cuts[s.index].cameraId}); return {kind:'cut',index:s.index+1}; }
    const e=p.entities.find(e=>e.id===s.entityId)!;
    if(e.locked) throw Error('对象已锁定');
    if(s.kind==='action') {
        const c=e.clips.find(c=>c.id===s.id)!,right=sliceAction(c,at,end);
        Object.assign(c,sliceAction(c,start,at,false));
        e.clips.push(right);e.clips.sort((a,b)=>a.start-b.start);
        return {kind:'action',entityId:e.id,id:right.id};
    }
    const path=e.path!; path.sections ??= pathSections(path);
    const part=path.sections[s.index], mid=part.from+(at-start)/(end-start)*(part.to-part.from);
    const right={...part,start:at,from:mid}; part.end=at; part.to=mid;
    path.sections.splice(s.index+1,0,right);
    return {kind:'path',entityId:e.id,index:s.index+1};
}
export function deleteClip(p:Project,s:TimelineSelection) {
    clipRange(p,s);
    if(s.kind==='cut') { if(s.index===0) throw Error('第一个切镜点不能删除'); p.cuts.splice(s.index,1); return; }
    const e=p.entities.find(e=>e.id===s.entityId)!; if(e.locked) throw Error('对象已锁定');
    if(s.kind==='action') e.clips=e.clips.filter(c=>c.id!==s.id);
    else { e.path!.sections ??= pathSections(e.path!); e.path!.sections.splice(s.index,1); if(!e.path!.sections.length) e.path=null; }
}
