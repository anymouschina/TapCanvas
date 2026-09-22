import { assertAnimated, type AnimatedNumber } from '../animation/channels.ts';

export const VISUAL_PRESETS = {
    mirror:'镜面',portal:'传送门画面',crack:'发光裂缝',dust:'尘埃',sparks:'火星',snow:'雪花',bubbles:'气泡',debris:'碎屑',cloud:'粒子云',smoke:'烟雾',fire:'火焰',stream:'水流',energy:'能量流',
    lattice:'点阵',helix:'螺旋',rings:'同心环',crystal:'晶格',fractal:'分形枝杈',swarm:'聚合团块',
    line:'曲线',ribbon:'丝带',trail:'轨迹带',grid:'网格',membrane:'波动薄膜',wave:'波浪',ripple:'涟漪',
    text:'文字与数字',arrow:'箭头',marker:'标记',waveform:'波形',data:'数据流',
    screen:'媒体平面',panorama:'全景包围',stars:'星空',gradient:'渐变背景',beam:'光束',halo:'光环',glow:'光斑',
} as const;
export type VisualPreset=keyof typeof VISUAL_PRESETS;
export interface VisualConfig {preset:VisualPreset;timeOffset?:number;cameraId?:string;lifetime?:number;count:number;seed:number;size:AnimatedNumber;spread:AnimatedNumber;speed:AnimatedNumber;amplitude:AnimatedNumber;frequency:AnimatedNumber;opacity:AnimatedNumber;start:number;end:number;text:string;secondaryColor:string;additive:boolean;quality:'draft'|'normal'|'high'}
export function defaultVisual(preset:VisualPreset):VisualConfig{return {preset,timeOffset:0,cameraId:'',lifetime:5,count:['dust','snow','stars','cloud','smoke','fire'].includes(preset)?600:200,seed:42,size:['screen','panorama','gradient','mirror','portal','text','data','waveform','arrow'].includes(preset)?1:['ribbon','membrane','wave','glow','beam'].includes(preset)?.2:.08,spread:3,speed:1,amplitude:.5,frequency:2,opacity:.8,start:0,end:0,text:'文字',secondaryColor:'#527bff',additive:['sparks','fire','energy','stars','beam','halo','glow'].includes(preset),quality:'normal'};}
export const FIELD_TYPES={wind:'风',attract:'吸引',repel:'排斥',vortex:'漩涡',turbulence:'湍流',wave:'波动'} as const;
export interface FieldConfig {timeOffset?:number;type:keyof typeof FIELD_TYPES;radius:number;strength:AnimatedNumber;falloff:number;targets:string[];start:number;end:number}
export const DEFORM_TYPES={bend:'弯曲',twist:'扭转',inflate:'膨胀',squeeze:'挤压',stretch:'拉伸',wave:'波动',collapse:'坍缩',shatter:'破碎'} as const;
export interface DeformConfig {timeOffset?:number;type:keyof typeof DEFORM_TYPES;amount:AnimatedNumber;axis:'x'|'y'|'z';frequency:number;speed:number;seed:number}
const record=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const range=(n:unknown,min:number,max:number)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
export function assertVisual(value:unknown){if(value===undefined)return;const d=defaultVisual('dust');if(!record(value)||Object.keys(value).some(k=>!Object.hasOwn(d,k))||!Object.hasOwn(VISUAL_PRESETS,String(value.preset))||!Number.isInteger(value.count)||!range(value.count,1,50000)||!Number.isInteger(value.seed)||!range(value.seed,0,2147483647)||!range(value.start,0,86400)||!range(value.end,0,86400)||value.end!==0&&Number(value.end)<=Number(value.start)||typeof value.text!=='string'||value.text.length>500||!/^#[a-f0-9]{6}$/i.test(String(value.secondaryColor))||typeof value.additive!=='boolean'||!['draft','normal','high'].includes(String(value.quality)))throw Error('视觉元素参数无效');
    if(value.timeOffset!==undefined&&!range(value.timeOffset,0,864000))throw Error('相位时间无效');
    if(value.cameraId!==undefined&&typeof value.cameraId!=='string'||value.lifetime!==undefined&&!range(value.lifetime,.1,1000))throw Error('视图摄影机或粒子寿命无效');
    for(const [key,min,max]of [['size',.001,100],['spread',.001,1000],['speed',-100,100],['amplitude',0,100],['frequency',0,100],['opacity',0,1]] as const)assertAnimated(value[key],min,max,key);
}
export function assertField(value:unknown,ids:readonly string[]){if(value===undefined)return;if(!record(value)||Object.keys(value).some(k=>!['timeOffset','type','radius','strength','falloff','targets','start','end'].includes(k))||!Object.hasOwn(FIELD_TYPES,String(value.type))||!range(value.radius,.01,1000)||!range(value.falloff,0,10)||!range(value.start,0,86400)||!range(value.end,0,86400)||value.end!==0&&Number(value.end)<=Number(value.start)||!Array.isArray(value.targets)||value.targets.some(id=>typeof id!=='string'||!ids.includes(id)))throw Error('影响区域或作用对象无效');if(value.timeOffset!==undefined&&!range(value.timeOffset,0,864000))throw Error('相位时间无效');assertAnimated(value.strength,-100,100,'场强度');}
export function assertDeform(value:unknown){if(value===undefined||value===null)return;if(!record(value)||Object.keys(value).some(k=>!['timeOffset','type','amount','axis','frequency','speed','seed'].includes(k))||!Object.hasOwn(DEFORM_TYPES,String(value.type))||!['x','y','z'].includes(String(value.axis))||!range(value.frequency,0,100)||!range(value.speed,-100,100)||!Number.isInteger(value.seed)||!range(value.seed,0,2147483647))throw Error('形变参数无效');if(value.timeOffset!==undefined&&!range(value.timeOffset,0,864000))throw Error('相位时间无效');assertAnimated(value.amount,-10,10,'形变幅度');}
export function seeded(index:number,seed:number){let x=(index+Math.imul(seed,374761393))|0;x=Math.imul(x^(x>>>13),1274126177);return ((x^(x>>>16))>>>0)/4294967296;}

export const SURFACE_VISUALS = new Set<VisualPreset>(['line','ribbon','trail','grid','membrane','wave','ripple','text','arrow','marker','waveform','data','screen','panorama','gradient','beam','halo','glow']);
