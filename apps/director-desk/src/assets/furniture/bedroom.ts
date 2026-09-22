import type { FurnitureStyle } from '../catalog/furniture.ts';
import type { FurnitureBuilder } from './shared.ts';

export function buildBedroom(f:FurnitureBuilder,style:FurnitureStyle):boolean {
    const {w,h,d,t,p,b,c,legs,anchor,light,dark}=f;
    if(['bed','bunk','crib','hospitalbed'].includes(style)){
        const surface=p.surfaceHeight,mat=Math.min(.14,surface*.3),levels=style==='bunk'?[surface,h*.77]:[surface];
        legs(style==='bunk'||style==='crib'?h:surface-mat,t/2);
        for(let i=0;i<levels.length;i++){
            const y=levels[i];b(w,mat,d,0,y-mat/2,0,light);b(w*.72,mat*.3,d*.14,0,y+mat*.15,-d*.36,light);
            anchor(`bed-${i+1}`,'bed',0,y,0);
            if(style==='bunk'&&i===1)for(const x of [-w/2+t/2,w/2-t/2])b(t,h-y,d,x,(y+h)/2);
        }
        if(style==='bed')b(w,h-surface,t,0,(h+surface)/2,-d/2+t/2);
        if(style==='bunk'){
            for(const x of [w*.08,w*.38])b(t,h*.8,t,x,h*.4,d/2-t);
            const steps=Math.max(3,Math.round(h/.25));for(let i=1;i<steps;i++)b(w*.3,t,t,w*.23,h*.8*i/steps,d/2-t);
        }
        if(style==='crib'||style==='hospitalbed'){
            for(const sign of [-1,1]){
                const y=style==='crib'?h:surface+(h-surface)*.5;
                b(t,t,d,sign*(w/2-t/2),y-t/2);
                for(let i=0;i<9;i++)b(t*.55,y-surface,t*.55,sign*(w/2-t/2),(y+surface)/2,-d/2+t+(d-t*2)*i/8);
                b(w,h-surface,t,0,(h+surface)/2,sign*(d/2-t/2));
            }
        }
        return true;
    }
    if(style==='screen'||style==='partition'||style==='blackboard'){
        const panels=style==='screen'?3:1,base=style==='blackboard'?h*.28:t;
        for(const x of [-w*.4,w*.4]){b(t,base,t,x,base/2);b(w*.15,t,d,x,t/2);}
        for(let i=0;i<panels;i++){
            const x=-w/2+(i+.5)*w/panels;b(w/panels-t,h-base,t,x,(h+base)/2);
            b(w/panels-t*3,h-base-t*3,t*.3,x,(h+base)/2,t*.6,style==='blackboard'?dark:light);
        }
        return true;
    }
    if(style==='coatstand'){
        const foot=c(.5,t,0,t/2);foot.scale.set(w,1,d);c(t*.65,h-t,0,(h+t)/2);
        for(const y of [h*.7,h*.92]){b(w,t,t,0,y);b(t,t,d,0,y);}
        return true;
    }
    if(style==='monitor'){
        b(w*.5,t,d,0,t/2);b(t,h*.45,t,0,h*.23);b(w,h*.7,t,0,h*.65,-d*.25);b(w-t*2,h*.7-t*2,t*.3,0,h*.65,-d*.25+t*.7,dark);
        return true;
    }
    return false;
}
