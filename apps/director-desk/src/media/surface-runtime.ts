import * as T from 'three';
import {ProjectionTexture} from './projection.ts';
import type { Project } from '../model.ts';
import { numberAt } from '../animation/channels.ts';
import { FACES, MAPPINGS, surfaceOpacity, type SurfaceLayer } from './model.ts';
import { MediaTexturePool } from './texture-pool.ts';

type Uniform = {value:unknown};
interface MaterialBinding { original:T.Material; material:T.Material; uniforms:Record<string,Uniform>; layers:string[] }
interface MeshBinding {mesh:T.Mesh; original:T.Material|T.Material[]; materials:MaterialBinding[]; index:number}
interface Instance {root:T.Group; signature:string; meshes:MeshBinding[]}
const scalar = (m:T.Material,k:string) => (m as unknown as Record<string,unknown>)[k];
const setScalar = (m:T.Material,k:string,v:unknown) => {(m as unknown as Record<string,unknown>)[k]=v;};
const mappingCode=`
varying vec3 vMediaPosition;
varying vec3 vMediaNormal;
varying vec2 vMediaUv;
uniform vec3 mediaMin;
uniform vec3 mediaSize;
vec2 mediaMapping(float mode) {
 vec3 p=(vMediaPosition-mediaMin)/mediaSize;
 if(mode<0.5)return vMediaUv;
 if(mode<1.5)return p.xy;
 if(mode<2.5){vec3 n=abs(normalize(vMediaNormal));if(n.y>n.x&&n.y>n.z)return p.xz;if(n.x>n.z)return p.zy;return p.xy;}
 vec3 d=p-0.5;
 if(mode<3.5)return vec2(atan(d.z,d.x)/6.2831853+0.5,asin(clamp(normalize(d).y,-1.0,1.0))/3.14159265+0.5);
 return vec2(atan(d.z,d.x)/6.2831853+0.5,p.y);
}
float mediaFace(float face){
 if(face<0.5)return 1.0;vec3 n=normalize(vMediaNormal);float dominant=max(max(abs(n.x),abs(n.y)),abs(n.z))-.001;
 if(face<1.5)return step(dominant,n.z);if(face<2.5)return step(dominant,-n.z);
 if(face<3.5)return step(dominant,-n.x);if(face<4.5)return step(dominant,n.x);
 if(face<5.5)return step(dominant,n.y);return step(dominant,-n.y);
}
float mediaAspect(float mode){
 if(mode>2.5&&mode<3.5)return 2.0;
 if(mode>3.5)return 3.14159265*max(mediaSize.x,mediaSize.z)/mediaSize.y;
 if(mode>.5&&mode<1.5)return mediaSize.x/mediaSize.y;
 vec3 n=abs(normalize(vMediaNormal));
 if(n.y>n.x&&n.y>n.z)return mediaSize.x/mediaSize.z;
 if(n.x>n.z)return mediaSize.z/mediaSize.y;
 return mediaSize.x/mediaSize.y;
}`;
function bindMaterial(original:T.Material,mesh:T.Mesh,layers:SurfaceLayer[],physical:boolean):MaterialBinding {
    let material:T.Material;
    if(physical&&(original as T.MeshStandardMaterial).isMeshStandardMaterial&&!(original as T.MeshPhysicalMaterial).isMeshPhysicalMaterial){
        const p=new T.MeshPhysicalMaterial();
        T.MeshStandardMaterial.prototype.copy.call(p,original as T.MeshStandardMaterial);
        // Standard.copy replaces defines; restore the physical shader branch (IOR, transmission).
        p.defines={STANDARD:'',PHYSICAL:''};material=p;
    }
    else material=original.clone();
    const bounds=mesh.geometry.boundingBox??(mesh.geometry.computeBoundingBox(),mesh.geometry.boundingBox!);
    const uniforms:Record<string,Uniform>={mediaMin:{value:bounds.min.clone()},mediaSize:{value:bounds.getSize(new T.Vector3()).max(new T.Vector3(.0001,.0001,.0001))}};
    let declarations='',body='';
    for(let i=0;i<layers.length;i++){
        const prefix=`media${i}`;uniforms[prefix+'Texture']={value:null};uniforms[prefix+'Crop']={value:new T.Vector4()};uniforms[prefix+'Transform']={value:new T.Vector4()};uniforms[prefix+'Settings']={value:new T.Vector4()};uniforms[prefix+'Fit']={value:new T.Vector3()};uniforms[prefix+'Alpha']={value:1};uniforms[prefix+'Unlit']={value:0};
        declarations+=`uniform sampler2D ${prefix}Texture;uniform vec4 ${prefix}Crop;uniform vec4 ${prefix}Transform;uniform vec4 ${prefix}Settings;uniform vec3 ${prefix}Fit;uniform float ${prefix}Alpha;uniform float ${prefix}Unlit;\n`;
        body+=`{ vec2 q=mediaMapping(${prefix}Settings.x)-.5;
            q=mat2(cos(${prefix}Settings.z),-sin(${prefix}Settings.z),sin(${prefix}Settings.z),cos(${prefix}Settings.z))*q;
            q=(q/${prefix}Transform.zw)+.5-${prefix}Transform.xy;
            float ratio=mediaAspect(${prefix}Settings.x)/${prefix}Fit.x;
            vec2 fit=${prefix}Fit.y<.5?vec2(1.):${prefix}Fit.y<1.5?vec2(max(1.,ratio),max(1.,1./ratio)):vec2(min(1.,ratio),min(1.,1./ratio));q=(q-.5)*fit+.5;
            float inside=${prefix}Settings.w<0.5?step(0.0,q.x)*step(q.x,1.0)*step(0.0,q.y)*step(q.y,1.0):1.0;
            vec2 uv=${prefix}Crop.xy+(${prefix}Settings.w>0.5?fract(q):clamp(q,0.00001,.99999))*${prefix}Crop.zw;
            vec4 pixel=texture2D(${prefix}Texture,uv);float alpha=pixel.a*${prefix}Alpha*mediaFace(${prefix}Settings.y)*inside;
            diffuseColor.rgb=mix(diffuseColor.rgb,pixel.rgb,alpha);
            MEDIA_UNLIT_${i}
        }\n`;
    }
    const previous=original.onBeforeCompile;
    material.onBeforeCompile=(shader,renderer)=>{
        previous.call(material,shader,renderer);Object.assign(shader.uniforms,uniforms);
        shader.vertexShader='varying vec3 vMediaPosition;varying vec3 vMediaNormal;varying vec2 vMediaUv;\n'+shader.vertexShader;
        shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvMediaPosition=position;vMediaNormal=normal;vMediaUv=uv;');
        shader.fragmentShader=mappingCode+'\n'+declarations+'\n'+shader.fragmentShader;
        let fragment=body;for(let i=0;i<layers.length;i++)fragment=fragment.replace(`MEDIA_UNLIT_${i}`,shader.fragmentShader.includes('totalEmissiveRadiance')?`totalEmissiveRadiance+=pixel.rgb*alpha*media${i}Unlit;diffuseColor.rgb*=1.0-alpha*media${i}Unlit;`:'');
        shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>','#include <map_fragment>\n'+fragment);
    };
    material.customProgramCacheKey=()=>`surface-v1:${original.customProgramCacheKey()}:${layers.length}:${physical}`;
    return {original,material,uniforms,layers:layers.map(l=>l.id)};
}
/** Material instances are retained while transforms, clocks and crop parameters change. */
export class SurfaceRuntime {
    readonly textures:MediaTexturePool;
    private instances=new Map<string,Instance>();
    private projectors=new Map<string,{light:T.SpotLight;canvas:ProjectionTexture}>();
    constructor(invalidate:()=>void){this.textures=new MediaTexturePool(invalidate);}
    describe(root:T.Group){let i=0;const result:{index:number;name:string;materials:number;uv:boolean}[]=[];root.traverse(o=>{if((o as T.Mesh).isMesh){const m=o as T.Mesh;result.push({index:i++,name:m.name||'表面 '+i,materials:Array.isArray(m.material)?m.material.length:1,uv:!!m.geometry.getAttribute('uv')});}});return result;}
    remove(id:string){const p=this.projectors.get(id);if(p){p.light.map=null;p.canvas.dispose();this.projectors.delete(id);}const instance=this.instances.get(id);if(!instance)return;for(const m of instance.meshes){m.mesh.material=m.original;m.materials.forEach(b=>b.material.dispose());}this.instances.delete(id);}
    sample(project:Project,models:Map<string,T.Group>,time:number){
        this.textures.begin();const live=new Set<string>();
        for(const entity of project.entities){const s=entity.surface,root=models.get(entity.id);if(!s||!root||!entity.visible||entity.kind==='camera')continue;live.add(entity.id);
            if(entity.light){const light=root.getObjectByName('director-light') as T.SpotLight,l=s.layers[0],resource=project.media?.find(r=>r.id===l?.resourceId);if(l&&resource&&light.isSpotLight){let p=this.projectors.get(entity.id);if(p&&p.light!==light){p.canvas.dispose();this.projectors.delete(entity.id);p=undefined;}if(!p){p={light,canvas:new ProjectionTexture()};this.projectors.set(entity.id,p);}light.map=p.canvas.update(this.textures.sample(resource,l,time),l,surfaceOpacity(l,time));}continue;}
            const physical=s.transmission!==undefined||s.ior!==undefined;
            const signature=JSON.stringify([physical,s.layers.map(l=>[l.id,l.resourceId,l.mesh,l.material])]);
            let instance=this.instances.get(entity.id);
            if(!instance||instance.root!==root||instance.signature!==signature){this.remove(entity.id);instance={root,signature,meshes:[]};let index=0;
                root.traverse(o=>{if(!(o as T.Mesh).isMesh)return;const mesh=o as T.Mesh,meshIndex=index++,original=mesh.material;
                    const originals=Array.isArray(original)?original:[original];const materials=originals.map((material,slot)=>bindMaterial(material,mesh,s.layers.filter(l=>(l.mesh===-1||l.mesh===meshIndex)&&(l.material===-1||l.material===slot)),physical));
                    mesh.material=Array.isArray(original)?materials.map(m=>m.material):materials[0].material;instance!.meshes.push({mesh,original,materials,index:meshIndex});
                });this.instances.set(entity.id,instance);
            }
            for(const mesh of instance.meshes)for(const b of mesh.materials){
                const originalColor=scalar(b.original,'color') as T.Color|undefined;if(originalColor)(scalar(b.material,'color') as T.Color)?.copy(originalColor);
                const originalEmissive=scalar(b.original,'emissive') as T.Color|undefined;if(originalEmissive)(scalar(b.material,'emissive') as T.Color)?.copy(originalEmissive);
                for(const key of ['roughness','metalness','transmission','opacity','emissiveIntensity','ior'] as const){const original=scalar(b.original,key);if(original!==undefined)setScalar(b.material,key,original);else if(key==='transmission')setScalar(b.material,key,0);if(key!=='emissiveIntensity'&&key!=='ior'&&s[key]!==undefined)setScalar(b.material,key,numberAt(s[key],time));}
                if(s.ior!==undefined)setScalar(b.material,'ior',s.ior);
                const transparent=b.original.transparent||Number(scalar(b.material,'opacity')??1)<1;
                if(b.material.transparent!==transparent){b.material.transparent=transparent;b.material.needsUpdate=true;}b.material.depthWrite=b.original.depthWrite&&!transparent;
                if(s.emissive!==undefined){const c=scalar(b.material,'emissive') as T.Color|undefined;c?.set(entity.color);setScalar(b.material,'emissiveIntensity',numberAt(s.emissive,time));}
                for(const [i,id]of b.layers.entries()){const l=s.layers.find(l=>l.id===id)!;const resource=project.media?.find(r=>r.id===l.resourceId);if(!resource)continue;
                    const prefix=`media${i}`,u=b.uniforms;u[prefix+'Texture'].value=this.textures.sample(resource,l,time);
                    (u[prefix+'Crop'].value as T.Vector4).set(l.crop[0],1-l.crop[1]-l.crop[3],l.crop[2],l.crop[3]);
                    (u[prefix+'Transform'].value as T.Vector4).set(...l.offset,...l.repeat);
                    const mapping=l.mapping==='uv'&&!mesh.mesh.geometry.getAttribute('uv')?'box':l.mapping;
                    (u[prefix+'Settings'].value as T.Vector4).set(Object.keys(MAPPINGS).indexOf(mapping),Object.keys(FACES).indexOf(l.face),l.rotation*Math.PI/180,l.tile?1:0);
                    const aspect=(resource.width*l.crop[2])/(resource.height*l.crop[3]);
                    (u[prefix+'Fit'].value as T.Vector3).set(aspect,l.fit==='stretch'?0:l.fit==='contain'?1:2,0);u[prefix+'Alpha'].value=surfaceOpacity(l,time);u[prefix+'Unlit'].value=l.unlit?1:0;
                }
            }
        }
        for(const [id,p]of this.projectors)if(!live.has(id)||!project.entities.find(e=>e.id===id)?.surface?.layers.length){p.light.map=null;p.canvas.dispose();this.projectors.delete(id);}
        for(const id of this.instances.keys())if(!live.has(id))this.remove(id);this.textures.end();
    }
    async prepare(){await this.textures.prepare();}
    dispose(){for(const id of this.instances.keys())this.remove(id);this.textures.dispose();for(const p of this.projectors.values()){p.light.map=null;p.canvas.dispose();}this.projectors.clear();}
}
