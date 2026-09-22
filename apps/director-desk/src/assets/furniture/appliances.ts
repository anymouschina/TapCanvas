import type { FurnitureStyle } from '../catalog/furniture.ts';
import type { FurnitureBuilder } from './shared.ts';

export function buildAppliance(f:FurnitureBuilder,style:FurnitureStyle):boolean {
    if(!['sink','stove','fridge','washer','toilet','bathtub','shower','vending'].includes(style))return false;
    const {w,h,d,t,b,c,anchor,dark,light,disk}=f;
    if(style==='bathtub'||style==='sink'){
        const base=style==='sink'?h*.58:t,rim=style==='sink'?h*.87:h;
        b(w,base,d,0,base/2);
        for(const x of [-w/2+t/2,w/2-t/2])b(t,rim-base,d,x,(rim+base)/2);
        for(const z of [-d/2+t/2,d/2-t/2])b(w,rim-base,t,0,(rim+base)/2,z);
        if(style==='sink'){c(t*.45,h-rim,0,(h+rim)/2,-d*.4);b(t,t,h*.1,0,h-t/2,-d*.4+h*.05);}
        anchor('basin','surface',0,base,0);return true;
    }
    if(style==='toilet'){
        b(w*.75,h*.34,d*.60,0,h*.17,d*.08);
        const ring=c(.5,t,0,h*.5);ring.scale.set(w,1,d*.72);
        c(w*.25,h*.12,0,h*.4,d*.06,light);
        b(w*.9,h*.5,d*.25,0,h*.75,-d*.375);
        anchor('seat','seat',0,h*.5+t/2,d*.08);return true;
    }
    if(style==='shower'){
        b(w,t,d);for(const x of [-w/2+t/2,w/2-t/2])for(const z of [-d/2+t/2,d/2-t/2])b(t,h,t,x,h/2,z);
        b(w,h,t,0,h/2,-d/2+t/2,light);b(t,h,d,-w/2+t/2,h/2,0,light);
        b(w,t,d,0,h-t/2);return true;
    }
    b(w,h,d);
    if(style==='stove'){
        for(const x of [-w*.25,w*.25])for(const z of [-d*.23,d*.23]){c(Math.min(w,d)*.16,t/3,x,h+t/6,z,dark);anchor(`burner-${x<0?'left':'right'}-${z<0?'back':'front'}`,'surface',x,h+t/3,z);}
        b(w*.75,h*.5,t,0,h*.38,d/2,dark);for(const x of [-w*.3,0,w*.3])disk(t,t,x,h*.78,d/2+t/2,light);
        anchor('cooktop','surface',0,h,0);
    }else if(style==='washer'){
        disk(w*.32,t,0,h*.43,d/2+t/2,light);disk(w*.25,t*.5,0,h*.43,d/2+t,dark);disk(t,t,w*.3,h*.86,d/2+t);
    }else if(style==='fridge'){
        b(w-t*2,t*.35,t,0,h*.68,d/2,dark);b(t*.6,h*.2,t,w*.34,h*.46,d/2+t/2,dark);b(t*.6,h*.12,t,w*.34,h*.83,d/2+t/2,dark);
    }else if(style==='vending'){
        b(w*.65,h*.65,t,-w*.1,h*.60,d/2, dark);
        for(let row=0;row<4;row++)for(let col=0;col<3;col++)b(w*.14,h*.10,t,-w*.30+col*w*.2,h*.35+row*h*.14,d/2+t,light);
        b(w*.6,h*.1,t,0,h*.14,d/2,dark);for(let i=0;i<4;i++)disk(t*.6,t,w*.37,h*.48+i*h*.065,d/2+t,light);
    }
    return true;
}
