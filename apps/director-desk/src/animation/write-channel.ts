import { numberAt, type AnimatedNumber } from './channels.ts';
/** Editing an animated value updates the current frame, never discards its other keys. */
export function writeChannel(previous:AnimatedNumber|undefined,value:number,time:number,key=false):AnimatedNumber {
    if(!key&&typeof previous!=='object')return value;
    const keys=typeof previous==='object'?[...previous.keys]:time>0?[{time:0,value:numberAt(previous,0,value)}]:[];
    const existing=keys.find(k=>Math.abs(k.time-time)<1e-7);
    return {keys:[...keys.filter(k=>Math.abs(k.time-time)>1e-7),{...existing,time,value}].sort((a,b)=>a.time-b.time)};
}
