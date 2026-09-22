import { Vector3, Vector4, type Group, type PerspectiveCamera } from 'three';
import { assertAnimated,numberAt,type AnimatedNumber } from '../animation/channels.ts';
import type { Entity } from '../model.ts';
export const WARP_TYPES={lens:'局部透镜',heat:'热浪扭曲',swirl:'空间漩涡',blackhole:'黑洞吸入',ripple:'空间涟漪'} as const;
export interface WarpConfig {timeOffset?:number;type:keyof typeof WARP_TYPES;radius:number;strength:AnimatedNumber;frequency:number;speed:number}
export function assertWarp(v:unknown){if(v===undefined)return;const x=v as WarpConfig;if(!x||typeof x!=='object'||Object.keys(x).some(k=>!['timeOffset','type','radius','strength','frequency','speed'].includes(k))||!Object.hasOwn(WARP_TYPES,x.type)||!Number.isFinite(x.radius)||x.radius<=0||x.radius>1000||!Number.isFinite(x.frequency)||x.frequency<0||x.frequency>100||!Number.isFinite(x.speed)||Math.abs(x.speed)>100)throw Error('空间扭曲参数无效');if(x.timeOffset!==undefined&&(!Number.isFinite(x.timeOffset)||x.timeOffset<0||x.timeOffset>864000))throw Error('相位时间无效');assertAnimated(x.strength,-2,2,'扭曲强度');}
export interface WarpSample {region:Vector4;settings:Vector4}
/** Only screen-visible regions are sent to the one shared post-processing pass. */
export function collectWarps(entities:Entity[],models:Map<string,Group>,camera:PerspectiveCamera,time:number):WarpSample[]{const result:WarpSample[]=[];
    for(const e of entities){if(!e.warp||!models.get(e.id)?.visible)continue;const center=models.get(e.id)!.getWorldPosition(new Vector3()),uv=center.clone().project(camera);if(uv.z<-1||uv.z>1)continue;
        const edge=center.clone().add(new Vector3(1,0,0).applyQuaternion(camera.quaternion).multiplyScalar(e.warp.radius)).project(camera);const radius=Math.abs(edge.x-uv.x)*.5;if(radius<.00001)continue;
        result.push({region:new Vector4(uv.x*.5+.5,uv.y*.5+.5,radius,numberAt(e.warp.strength,time)),settings:new Vector4(Object.keys(WARP_TYPES).indexOf(e.warp.type),e.warp.frequency,e.warp.speed*(time+(e.warp.timeOffset??0)),0)});if(result.length===8)break;
    }return result;
}
export const warpShader=`
uniform int warpCount;uniform vec4 warpRegions[8];uniform vec4 warpSettings[8];
vec2 warpedUv(vec2 uv){for(int i=0;i<8;i++){if(i>=warpCount)break;vec4 r=warpRegions[i];vec4 s=warpSettings[i];vec2 p=uv-r.xy;p.y/=aspect;float d=length(p)/r.z;if(d>=1.0)continue;float falloff=(1.-d)*(1.-d);float k=r.w*falloff;
 if(s.x<.5)p*=1.-k*.6;
 else if(s.x<1.5)p+=vec2(sin(p.y*s.y*80.+s.z*3.),cos(p.x*s.y*80.+s.z*2.))*k*.015;
 else if(s.x<2.5){float a=k*3.;p=mat2(cos(a),-sin(a),sin(a),cos(a))*p;}
 else if(s.x<3.5)p*=1.+k*2.;
 else p*=1.+sin(d*s.y*20.-s.z*3.)*k*.25;
 p.y*=aspect;uv=clamp(r.xy+p,vec2(.001),vec2(.999));}return uv;}
`;
