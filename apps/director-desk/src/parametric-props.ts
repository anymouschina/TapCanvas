import type { Entity } from './model.ts';
export interface PropParameters { width:number; length:number; height:number; steps:number; rise:number; tread:number; landing:number; layout:'straight'|'crest'|'return'; }
export const parameterDefaults:Record<string,PropParameters>={
 stairs:{width:1.2,length:1.68,height:1.08,steps:6,rise:.18,tread:.28,landing:1.2,layout:'straight'},
 road:{width:6,length:10,height:.1,steps:6,rise:.18,tread:.28,landing:1.2,layout:'straight'},
 wall:{width:.12,length:2,height:2.8,steps:6,rise:.18,tread:.28,landing:1.2,layout:'straight'},
 ground:{width:10,length:10,height:.12,steps:6,rise:.18,tread:.28,landing:1.2,layout:'straight'}
};
export function propParameters(e:Entity):PropParameters { return {...parameterDefaults[e.asset],...e.parameters}; }
export function validatePropParameters(e:Entity) {
 if(e.parameters===undefined)return;
 if(!e.parameters || typeof e.parameters!=='object' || Array.isArray(e.parameters))throw Error('白模结构参数格式无效');
 if(!parameterDefaults[e.asset])throw Error('该白模不支持结构参数');
 const p=propParameters(e);
 for(const key of ['width','length','height','rise','tread','landing'] as const)if(!Number.isFinite(p[key]) || p[key]<.02 || p[key]>500)throw Error('结构尺寸应在 0.02 至 500 米之间');
 if(!Number.isInteger(p.steps)||p.steps<1||p.steps>128)throw Error('每段楼梯级数应为 1 至 128');
 if(!['straight','crest','return'].includes(p.layout))throw Error('楼梯结构类型无效');
}
export interface StructureBox {width:number;height:number;depth:number;x:number;y:number;z:number;mark?:boolean;}
export function structureBoxes(e:Entity):StructureBox[] {
 const p=propParameters(e),out:StructureBox[]=[];
 const add=(width:number,height:number,depth:number,x=0,y=height/2,z=0,mark=false)=>out.push({width,height,depth,x,y,z,mark});
 if(e.asset==='stairs'){
  const n=p.steps,h=n*p.rise,last=-(n-1)*p.tread;
  for(let i=0;i<n;i++)add(p.width,(i+1)*p.rise,p.tread,0,(i+1)*p.rise/2,-i*p.tread);
  if(p.layout!=='straight'){
   const z=last-p.tread/2-p.landing/2;
   add(p.layout==='return'?p.width*2:p.width,h,p.landing,p.layout==='return'?p.width/2:0,h/2,z);
   for(let i=0;i<n;i++){
    const height=p.layout==='return'?h+(i+1)*p.rise:h-i*p.rise;
    add(p.width,height,p.tread,p.layout==='return'?p.width:0,height/2,p.layout==='return'?last+i*p.tread:last-p.landing-(i+1)*p.tread);
   }
  }
 }else if(e.asset==='wall')add(p.length,p.height,p.width);
 else {
  add(p.width,p.height,p.length,0,-p.height/2);
  if(e.asset==='road')for(let z=-p.length/2+1;z<=p.length/2-1;z+=2)add(.1,.005,Math.min(1,p.length),0,.003,z,true);
 }
 return out;
}
