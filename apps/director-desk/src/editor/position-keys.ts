import type { Entity, Vec3 } from '../model.ts';
/** Record into the existing waypoint data, never maintain a second animation system. */
export function recordPositionKey(e:Entity,time:number,position:Vec3,fps:number) {
 if(e.locked)throw Error('对象已锁定');
 if(e.handBinding)throw Error('手持道具请先解除绑定，再记录独立位置关键帧');
 if(e.structureLink)throw Error('建筑模块请先解除连接，再记录独立位置关键帧');
 const at=Math.round(time*fps)/fps;
 if(!Number.isFinite(at)||at<0||position.some(n=>!Number.isFinite(n)))throw Error('关键帧时间或位置无效');
 e.path ??= {smooth:false,points:[]};
 let sourceTime=at;
 if(e.path.sections){
  const section=e.path.sections.find(s=>at>=s.start-1e-7&&at<=s.end+1e-7);
  if(!section)throw Error('已分割路线请在片段内部记录位置，或重画路线后继续添加');
  sourceTime=section.from+(at-section.start)/(section.end-section.start)*(section.to-section.from);
 }
 const found=e.path.points.find(p=>Math.abs(p.time-sourceTime)<1e-7);
 if(found)found.position=[...position];else e.path.points.push({time:sourceTime,position:[...position]});
 e.path.points.sort((a,b)=>a.time-b.time);
}
