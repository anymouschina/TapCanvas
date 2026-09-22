import {makePlanarView} from './planar-view.ts';
import {entityPosition} from '../timeline.ts';
import * as T from 'three';
import type { Entity } from '../model.ts';
import { numberAt } from '../animation/channels.ts';
import { seeded, type VisualConfig } from './model.ts';

const vertex=`uniform int fieldCount;uniform vec4 fieldCenters[8];uniform vec4 fieldSettings[8];uniform vec4 fieldDirections[8];
uniform float clock;uniform float lifetime;uniform float spread;uniform float size;uniform float amplitude;uniform float frequency;attribute vec4 randoms;varying float fade;
void main(){vec3 p=position;float a=fract(randoms.w+clock/lifetime);fade=1.0;
PRESET
 vec4 world=modelMatrix*vec4(p,1.);
 for(int i=0;i<8;i++){if(i>=fieldCount)break;vec4 f=fieldCenters[i],s=fieldSettings[i],dir=fieldDirections[i];vec3 d=world.xyz-f.xyz;float dist=length(d);if(dist>=f.w)continue;float k=s.y*pow(1.-dist/f.w,s.z);
 if(s.x<.5)world.xyz+=dir.xyz*k*s.w;
 else if(s.x<2.5)world.xyz+=normalize(d+.000001)*min(dist,abs(k))*sign(k)*(s.x<1.5?-1.:1.);
 else if(s.x<3.5){float a=k*s.w;world.xyz=f.xyz+vec3(cos(a)*d.x-sin(a)*d.z,d.y,sin(a)*d.x+cos(a)*d.z);}
 else if(s.x<4.5)world.xyz+=vec3(sin(s.w*1.7+d.x),sin(s.w*2.3+d.y),cos(s.w*1.3+d.z))*k;
 else world.y+=sin(dist*2.-s.w*2.)*k;}
 vec4 mv=viewMatrix*world;gl_Position=projectionMatrix*mv;gl_PointSize=clamp(size*300.0/max(.1,-mv.z),1.0,96.0);
}`;
const fragment=`uniform vec3 color;uniform vec3 secondary;uniform float opacity;varying float fade;
void main(){float d=length(gl_PointCoord-.5)*2.;if(d>1.)discard;float alpha=pow(1.-d,SOFTNESS)*opacity*fade;
gl_FragColor=vec4(mix(color,secondary,d*.6),alpha);#include <tonemapping_fragment>
#include <colorspace_fragment>
}`.replace(';#include',';\n#include');
const formulas:Record<string,string>={
    dust:'p=position*spread+vec3(sin(clock+randoms.x*6.),sin(clock*.7+randoms.y*6.),cos(clock+randoms.z*6.))*amplitude;',
    snow:'p=position*spread;p.y=(.5-a)*spread;p.x+=sin(clock+randoms.x*6.)*amplitude;',
    sparks:'p=vec3((randoms.x-.5)*a, a*(1.-a)*3.,(randoms.z-.5)*a)*spread;fade=1.-a;',
    bubbles:'p=position*spread;p.y=(a-.5)*spread;p.x+=sin(clock+randoms.x*6.)*amplitude;',
    smoke:'p=vec3((randoms.x-.5)*a,a-.5,(randoms.z-.5)*a)*spread;p.x+=sin(a*frequency+clock)*amplitude;fade=sin(a*3.14159);',
    fire:'p=vec3((randoms.x-.5)*(1.-a),a,(randoms.z-.5)*(1.-a))*spread;p.x+=sin(a*frequency+clock)*amplitude*.2;fade=1.-a;',
    stream:'p=vec3((a-.5)*spread,sin(a*frequency*6.283+clock)*amplitude,randoms.z*.2);',
    energy:'p=vec3(cos(a*frequency*6.283+clock)*amplitude,(a-.5)*spread,sin(a*frequency*6.283+clock)*amplitude);',
    cloud:'p=position*spread+normalize(position+.001)*sin(clock+randoms.w*6.283)*amplitude;',
    debris:'p=position*spread*a;p.y-=a*a*amplitude;fade=1.-a;',
    helix:'p=vec3(cos(randoms.w*frequency*6.283+clock)*spread*.4,(randoms.w-.5)*spread,sin(randoms.w*frequency*6.283+clock)*spread*.4);',
    rings:'float ring=floor(randoms.z*5.)+1.;float angle=randoms.w*6.283+clock;p=vec3(cos(angle),sin(angle),0.)*ring*spread*.1;',
    swarm:'p=position*(spread*(.5+.5*sin(clock*frequency))+amplitude);',
    stars:'p=normalize(position)*spread;fade=.65+.35*sin(clock+randoms.w*6.283);',
    lattice:'p=position*spread;p.y+=sin(p.x*frequency+clock)*amplitude;',
    crystal:'p=position*spread;p*=1.+sin(clock)*amplitude*.1;',
};
const particleKinds=new Set(Object.keys(formulas));
export function makeVisual(entity:Entity){const group=new T.Group();const v=entity.visual!;
    if(entity.warp){const m=new T.Mesh(new T.SphereGeometry(entity.warp.type==='blackhole'?.15:1,24,12),new T.MeshBasicMaterial({color:entity.warp.type==='blackhole'?'#000000':entity.color,wireframe:entity.warp.type!=='blackhole'}));if(entity.warp.type!=='blackhole')m.layers.set(1);group.add(m);if(entity.warp.type==='blackhole'){const ring=new T.Mesh(new T.TorusGeometry(.2,.012,8,48),new T.MeshBasicMaterial({color:entity.color}));group.add(ring);}return group;}
    if(entity.field){const m=new T.Mesh(new T.SphereGeometry(1,24,12),new T.MeshBasicMaterial({color:entity.color,wireframe:true,transparent:true,opacity:.3}));m.layers.set(1);group.add(m);return group;}
    if(v.preset==='mirror'||v.preset==='portal'){group.add(makePlanarView(entity));return group;}
    if(particleKinds.has(v.preset)){
        const n=v.count,positions=new Float32Array(n*3),randoms=new Float32Array(n*4),side=Math.ceil(Math.cbrt(n));
        for(let i=0;i<n;i++){for(let j=0;j<4;j++)randoms[i*4+j]=seeded(i*4+j,v.seed);for(let j=0;j<3;j++)positions[i*3+j]=randoms[i*4+j]-.5;
            if(v.preset==='lattice'||v.preset==='crystal'){positions[i*3]=(i%side)/(side-1||1)-.5;positions[i*3+1]=(Math.floor(i/side)%side)/(side-1||1)-.5;positions[i*3+2]=Math.floor(i/(side*side))/(side-1||1)-.5;}}
        const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.BufferAttribute(positions,3));geometry.setAttribute('randoms',new T.BufferAttribute(randoms,4));
        const material=new T.ShaderMaterial({uniforms:uniforms(entity,v),vertexShader:vertex.replace('PRESET',formulas[v.preset]),fragmentShader:fragment.replace('SOFTNESS',['smoke','cloud','fire'].includes(v.preset)?'2.0':'.4'),transparent:true,depthWrite:false,blending:v.additive?T.AdditiveBlending:T.NormalBlending});
        const points=new T.Points(geometry,material);points.frustumCulled=false;group.add(points);group.userData.visualMaterial=material;group.userData.visualPoints=points;return group;
    }
    if(['text','data','waveform','gradient'].includes(v.preset)){
        if(typeof document==='undefined'){group.add(new T.Mesh(new T.PlaneGeometry(4,2),new T.MeshBasicMaterial({color:entity.color})));return group;}
        const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=512;const c=canvas.getContext('2d')!;
        if(v.preset==='gradient'){const g=c.createLinearGradient(0,0,0,512);g.addColorStop(0,entity.color);g.addColorStop(1,v.secondaryColor);c.fillStyle=g;c.fillRect(0,0,1024,512);}
        else if(v.preset==='waveform'){c.strokeStyle='#ffffff';c.lineWidth=6;c.beginPath();for(let x=0;x<1024;x++){const y=256+Math.sin(x*.045)*Math.sin(x*.013)*180;x?c.lineTo(x,y):c.moveTo(x,y);}c.stroke();}
        else {c.fillStyle='#ffffff';c.font=v.preset==='text'?'bold 112px sans-serif':'28px monospace';c.textAlign='center';c.textBaseline='middle';if(v.preset==='text')c.fillText(v.text,512,256,1000);else for(let x=16;x<1024;x+=32)for(let y=16;y<512;y+=40)c.fillText(String(Math.floor(seeded(x+y,v.seed)*10)),x,y);}
        const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;texture.wrapS=texture.wrapT=T.RepeatWrapping;const mesh=new T.Mesh(new T.PlaneGeometry(4,2),new T.MeshBasicMaterial({color:entity.color,map:texture,transparent:true,side:T.DoubleSide}));group.add(mesh);group.userData.visualTexture=texture;return group;
    }
    if(v.preset==='fractal'||v.preset==='crack'){
        const points:number[]=[];function branch(p:T.Vector3,d:T.Vector3,length:number,level:number,index:number){const q=p.clone().addScaledVector(d,length);points.push(...p.toArray(),...q.toArray());if(!level)return;for(let j=0;j<3;j++){const next=d.clone().applyAxisAngle(new T.Vector3(seeded(index+j,1),.2,seeded(index+j,2)).normalize(),(j-1)*.8);branch(q,next,length*.65,level-1,index*3+j);}}
        branch(new T.Vector3(),new T.Vector3(0,1,0),v.preset==='crack'?.7:1,Math.min(5,Math.max(1,Math.round(Math.log2(v.count)/2))),v.seed);
        const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(points,3));group.add(new T.LineSegments(geometry,new T.LineBasicMaterial({color:entity.color,transparent:true})));return group;
    }
    if(v.preset==='arrow'){const material=new T.MeshStandardMaterial({color:entity.color});const shaft=new T.Mesh(new T.CylinderGeometry(.05,.05,1.4,16),material),tip=new T.Mesh(new T.ConeGeometry(.2,.5,16),material);shaft.position.y=.7;tip.position.y=1.65;group.add(shaft,tip);return group;}
    let geometry:T.BufferGeometry;
    if(v.preset==='panorama')geometry=new T.SphereGeometry(1,48,24);
    else if(['halo','marker','ripple'].includes(v.preset))geometry=new T.TorusGeometry(1,.035,8,96);
    else if(v.preset==='beam')geometry=new T.ConeGeometry(1,3,32,1,true);
    else if(v.preset==='grid')geometry=new T.PlaneGeometry(4,4,20,20);
    else geometry=new T.PlaneGeometry(['line','ribbon','trail'].includes(v.preset)?6:4,['line','trail'].includes(v.preset)?.025:v.preset==='ribbon'?.3:4,96,12);
    const material=new T.MeshStandardMaterial({color:entity.color,side:T.DoubleSide,transparent:true,depthWrite:!['beam','glow'].includes(v.preset),wireframe:v.preset==='grid',emissive:entity.color,emissiveIntensity:v.additive?1:0});
    if(typeof document!=='undefined'&&(v.preset==='glow'||v.preset==='beam')){const canvas=document.createElement('canvas');canvas.width=canvas.height=128;const c=canvas.getContext('2d')!;const gradient=v.preset==='glow'?c.createRadialGradient(64,64,0,64,64,64):c.createLinearGradient(0,0,0,128);gradient.addColorStop(0,'rgba(255,255,255,1)');gradient.addColorStop(1,'rgba(0,0,0,0)');c.fillStyle=gradient;c.fillRect(0,0,128,128);const texture=new T.CanvasTexture(canvas);material.alphaMap=texture;group.userData.visualAlpha=texture;}
    if(v.preset==='panorama'){material.side=T.BackSide;material.depthWrite=false;}
    if(v.additive)material.blending=T.AdditiveBlending;
    const mesh=new T.Mesh(geometry,material);if(['wave','ripple'].includes(v.preset))mesh.rotation.x=-Math.PI/2;
    group.add(mesh);group.userData.visualBase=geometry.getAttribute('position').array.slice();return group;
}
function uniforms(e:Entity,v:VisualConfig){return {fieldCount:{value:0},fieldCenters:{value:Array.from({length:8},()=>new T.Vector4())},fieldSettings:{value:Array.from({length:8},()=>new T.Vector4())},fieldDirections:{value:Array.from({length:8},()=>new T.Vector4())},clock:{value:0},lifetime:{value:v.lifetime??5},spread:{value:numberAt(v.spread,0)},size:{value:numberAt(v.size,0)},amplitude:{value:0},frequency:{value:1},color:{value:new T.Color(e.color)},secondary:{value:new T.Color(v.secondaryColor)},opacity:{value:1}};}
export function sampleVisual(e:Entity,root:T.Group,time:number,draft:boolean){
    if(e.warp){root.children.forEach(child=>child.scale.setScalar(e.warp!.radius));return;}
    if(e.field){root.children[0]?.scale.setScalar(e.field.radius);return;}
    const v=e.visual;if(!v)return;root.visible=e.visible&&time>=v.start&&(!v.end||time<v.end);if(!root.visible)return;
    const lifetime=v.lifetime??5,clock=(time-v.start+(v.timeOffset??0))*numberAt(v.speed,time),spread=numberAt(v.spread,time),size=numberAt(v.size,time),amplitude=numberAt(v.amplitude,time),frequency=numberAt(v.frequency,time),opacity=numberAt(v.opacity,time);
    const material=root.userData.visualMaterial as T.ShaderMaterial|undefined;
    if(material){const u=material.uniforms;for(const [key,value]of Object.entries({clock,spread,size,amplitude,frequency,opacity,lifetime:v.lifetime??5}))u[key].value=value;u.color.value.set(e.color);u.secondary.value.set(v.secondaryColor);
        const count=draft||v.quality==='draft'?Math.ceil(v.count/4):v.count;(root.userData.visualPoints as T.Points).geometry.setDrawRange(0,count);return;}
    const mesh=root.children[0] as T.Mesh;
    if(mesh.userData.planarView){mesh.scale.setScalar(size);(mesh.material as T.Material).opacity=opacity;(mesh.material as T.Material).transparent=opacity<1;const u=(mesh.material as T.ShaderMaterial).uniforms;if(u?.visualOpacity)u.visualOpacity.value=opacity;return;}
    if(root.userData.visualTexture){if(v.preset==='data')(root.userData.visualTexture as T.Texture).offset.y=clock*.1;mesh.scale.setScalar(size);(mesh.material as T.Material).opacity=opacity;return;}
    if(v.preset==='fractal'||v.preset==='crack'){mesh.scale.setScalar(spread);mesh.rotation.y=clock/lifetime;(mesh.material as T.LineBasicMaterial).color.set(e.color);(mesh.material as T.Material).opacity=opacity;return;}
    if(v.preset==='arrow'){root.children.forEach((child,i)=>{child.scale.setScalar(size);child.position.y=(i===0?.7:1.65)*size;const m=(child as T.Mesh).material as T.Material;m.opacity=opacity;m.transparent=opacity<1;});return;}
    const m=mesh.material as T.MeshStandardMaterial;m.color.set(e.color);m.opacity=opacity;m.emissive.set(e.color);mesh.scale.setScalar(v.preset==='panorama'?spread:size*10);
    if(['line','ribbon','trail','membrane','wave'].includes(v.preset)&&root.userData.visualSample!==JSON.stringify([clock,amplitude,frequency,e.path])){root.userData.visualSample=JSON.stringify([clock,amplitude,frequency,e.path]);const a=mesh.geometry.getAttribute('position') as T.BufferAttribute,base=root.userData.visualBase as Float32Array;
        for(let i=0;i<a.count;i++){a.setXYZ(i,base[i*3],base[i*3+1],base[i*3+2]+Math.sin(base[i*3]*frequency+clock)*Math.cos(base[i*3+1]*frequency+clock*.5)*amplitude);}if(v.preset==='trail'&&e.path?.points.length){root.updateMatrixWorld(true);const inverse=root.matrixWorld.clone().invert();for(let i=0;i<a.count;i++){const u=(base[i*3]+3)/6,at=Math.max(v.start,time-(1-u)*(v.lifetime??5));const pos=entityPosition(e,at).applyMatrix4(inverse);a.setXYZ(i,pos.x/mesh.scale.x,pos.y/mesh.scale.y+base[i*3+1],pos.z/mesh.scale.z);}}a.needsUpdate=true;mesh.geometry.computeVertexNormals();mesh.geometry.computeBoundingSphere();}
    if(v.preset==='ripple')mesh.scale.setScalar(spread*(.05+(clock/lifetime%1)));if(v.preset==='halo'||v.preset==='marker')mesh.rotation.z=clock;
}
export function disposeVisual(root:T.Group){root.traverse(o=>o.userData.disposePlanar?.());(root.userData.visualAlpha as T.Texture|undefined)?.dispose();(root.userData.visualTexture as T.Texture|undefined)?.dispose();}
