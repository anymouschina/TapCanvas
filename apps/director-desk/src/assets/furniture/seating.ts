import type { FurnitureStyle } from '../catalog/furniture.ts';
import type { FurnitureBuilder } from './shared.ts';

export function buildSeating(f:FurnitureBuilder,style:FurnitureStyle):boolean {
    if(!['chair','stool','bench','armchair','sofa','barstool','lounger','waitingbench'].includes(style))return false;
    const {w,h,d,t,p,b,c,legs,anchor,light}=f,seat=p.surfaceHeight??h,thick=style==='sofa'?Math.min(.15,seat*.3):t*1.5;
    const soft=style==='sofa',multiple=style==='waitingbench'||soft;
    const seats=['bench','sofa','waitingbench'].includes(style)?Math.max(1,Math.floor(w/.6)):1;
    if(style==='barstool'){c(.5,t).scale.set(w*.86,1,d*.86);c(t*.7,h-thick,0,(h-thick)/2);c(.5,thick,0,h-thick/2).scale.set(w,1,d);}
    else if(soft){b(w-t*2,seat*.75,d-t*2,0,seat*.375);}
    else legs(seat-thick,t*1.5);
    if(style!=='barstool') {
        if(multiple){for(let i=0;i<seats;i++)b(w/seats-t,thick,d*.85,-w/2+(i+.5)*w/seats,seat-thick/2,d*.04,light);}
        else b(w,thick,style==='lounger'?d*.67:d,0,seat-thick/2,style==='lounger'?d*.165:0,light);
    }
    if(p.surfaceHeight!==undefined){
        if(style==='lounger'){
            const rise=h-seat,run=d*.33,piece=b(w,Math.hypot(rise,run),t,0,seat+rise/2,-d*.335,light);piece.rotation.x=Math.atan2(run,rise);
        } else b(w,h-seat,soft?Math.min(d*.18,.17):t,0,seat+(h-seat)/2,-d/2+(soft?Math.min(d*.18,.17):t)/2);
    }
    if(['armchair','sofa'].includes(style))for(const sign of [-1,1]){
        const arm=seat+(h-seat)*.5;
        b(soft?w*.08:t,soft?arm: t,d,sign*(w/2-(soft?w*.08:t)/2),soft?arm/2:arm-t/2);
        if(!soft)b(t,arm-seat,t,sign*(w/2-t/2),(arm+seat)/2,d/2-t);
    }
    for(let i=0;i<seats;i++)anchor(`seat-${i+1}`,'seat',-w/2+(i+.5)*w/seats,seat,style==='lounger'?d*.17:0);
    return true;
}
