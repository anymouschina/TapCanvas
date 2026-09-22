import { assertAnimated, numberAt, type AnimatedNumber } from '../animation/channels.ts';

export interface MediaResource { id: string; name: string; mime: string; data: string; width: number; height: number; duration: number }
export const MAPPINGS = { uv: '模型 UV', plane: '平面', box: '盒式', sphere: '球面', cylinder: '柱面' } as const;
export const FACES = { all: '所有方向', front: '正面 +Z', back: '背面 −Z', left: '左面 −X', right: '右面 +X', top: '顶面 +Y', bottom: '底面 −Y' } as const;
export interface SurfaceLayer {
    id: string; resourceId: string; timeOffset?:number;
    /** Stable depth-first mesh index; -1 means every mesh. Material slot -1 means all slots. */
    mesh: number; material: number; face: keyof typeof FACES; mapping: keyof typeof MAPPINGS;
    crop: [number, number, number, number]; offset: [number, number]; repeat: [number, number]; rotation: number; tile?: boolean;
    fit: 'stretch' | 'contain' | 'cover'; opacity: AnimatedNumber; unlit: boolean;
    start: number; trimIn: number; trimOut: number; speed: number; loop: boolean;
}
export interface SurfaceAppearance { layers: SurfaceLayer[]; roughness?: AnimatedNumber; metalness?: AnimatedNumber; transmission?: AnimatedNumber; ior?: number; opacity?: AnimatedNumber; emissive?: AnimatedNumber }
export const defaultSurfaceLayer = (resourceId: string, id: string = crypto.randomUUID()): SurfaceLayer => ({ id, resourceId,timeOffset:0, mesh: -1, material: -1, face: 'all', mapping: 'uv', crop: [0,0,1,1], offset: [0,0], repeat: [1,1], rotation: 0, tile: false, fit: 'stretch', opacity: 1, unlit: false, start: 0, trimIn: 0, trimOut: 0, speed: 1, loop: true });
const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const finite = (x: unknown, min: number, max: number) => typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max;
const tuple = (x: unknown, n: number, min: number, max: number): x is number[] => Array.isArray(x) && x.length === n && x.every(v => finite(v,min,max));
const payloadCache = new Map<string, WeakRef<object>>();
const payloadSnapshots = new WeakMap<object,{data:string;mime:string}>();
export function assertMediaResources(resources: unknown): asserts resources is MediaResource[] | undefined {
    if (resources === undefined) return;
    if (!Array.isArray(resources) || resources.length > 1000) throw Error('媒体资源列表无效');
    const ids = new Set<string>();
    for (const r of resources) {
        if (!record(r) || Object.keys(r).some(k=>!['id','name','mime','data','width','height','duration'].includes(k)) || typeof r.id !== 'string' || !/^media-[a-f0-9]{64}$/.test(r.id) || ids.has(r.id)
            || typeof r.name !== 'string' || !r.name.trim() || r.name.length>200 || !['image/png','image/jpeg','image/webp','video/mp4','video/webm'].includes(String(r.mime))
            || !finite(r.width,1,16384) || !finite(r.height,1,16384) || !finite(r.duration,0,86400) || typeof r.data !== 'string' || r.data.length>720_000_000) throw Error('媒体资源元数据无效');
        const previous=payloadCache.get(r.id)?.deref(),snapshot=previous&&payloadSnapshots.get(previous);
        if (snapshot?.data !== r.data || snapshot?.mime !== r.mime) {
            if (!r.data.startsWith(`data:${r.mime};base64,`) || !/^[A-Za-z0-9+/]+={0,2}$/.test(r.data.slice(r.data.indexOf(',')+1))) throw Error('媒体必须是工程内嵌的 PNG、JPEG、WebP、MP4 或 WebM');
        }
        payloadSnapshots.set(r,{data:r.data,mime:String(r.mime)});
        payloadCache.set(r.id,new WeakRef(r));if(payloadCache.size>128)payloadCache.delete(payloadCache.keys().next().value!);
        ids.add(r.id);
    }
}
export function assertSurface(surface: unknown, resources: readonly MediaResource[] = []) {
    if (surface === undefined || surface === null) return;
    if (!record(surface) || Object.keys(surface).some(k=>!['layers','roughness','metalness','transmission','ior','opacity','emissive'].includes(k)) || !Array.isArray(surface.layers) || surface.layers.length>8) throw Error('材质需要 layers 数组，每个对象最多 8 层');
    const ids=new Set<string>();
    for(const l of surface.layers) {
        if (!record(l) || Object.keys(l).some(k=>!Object.keys(defaultSurfaceLayer('','')).includes(k)) || typeof l.id!=='string' || !l.id || l.id.length>200 || ids.has(l.id) || !resources.some(r=>r.id===l.resourceId)
            || !Number.isInteger(l.mesh) || !finite(l.mesh,-1,100000) || !Number.isInteger(l.material) || !finite(l.material,-1,10000)
            || !Object.hasOwn(FACES,String(l.face)) || !Object.hasOwn(MAPPINGS,String(l.mapping)) || !tuple(l.crop,4,0,1) || !(l.crop[2]>0&&l.crop[3]>0&&l.crop[0]+l.crop[2]<=1.000001&&l.crop[1]+l.crop[3]<=1.000001)
            || !tuple(l.offset,2,-1000,1000) || !tuple(l.repeat,2,.001,1000) || !finite(l.rotation,-36000,36000) || !['stretch','contain','cover'].includes(String(l.fit)) || typeof l.unlit!=='boolean'
            || !finite(l.start,0,86400) || !finite(l.trimIn,0,86400) || !finite(l.trimOut,0,86400) || (l.trimOut!==0&&Number(l.trimOut)<=Number(l.trimIn)) || !finite(l.speed,.01,100) || typeof l.loop!=='boolean') throw Error('表面贴图参数、选区或资源引用无效');
        const resource=resources.find(r=>r.id===l.resourceId)!;
        if(l.timeOffset!==undefined&&!finite(l.timeOffset,0,864000))throw Error('视频相位时间无效');
        if(l.tile!==undefined&&typeof l.tile!=='boolean')throw Error('平铺开关无效');
        if(resource.mime.startsWith('video/')&&(Number(l.trimIn)>=resource.duration||Number(l.trimOut)>resource.duration))throw Error('视频截取超出素材时长');
        assertAnimated(l.opacity,0,1,'贴图透明度'); ids.add(l.id);
    }
    for(const key of ['roughness','metalness','transmission','opacity','emissive'] as const)if(surface[key]!==undefined)assertAnimated(surface[key],0,key==='emissive'?20:1,key);
    if(surface.ior!==undefined&&!finite(surface.ior,1,2.5))throw Error('折射率需要 1—2.5');
}
export function mediaTime(layer: SurfaceLayer, resource: MediaResource, time: number) {
    if(time<layer.start)return null;
    const end=Math.min(resource.duration,layer.trimOut||resource.duration),length=end-layer.trimIn;
    if(length<=0)return layer.trimIn;
    const elapsed=(time-layer.start+(layer.timeOffset??0))*layer.speed;
    return layer.trimIn+(layer.loop?elapsed%length:Math.min(elapsed,Math.max(0,length-.00001)));
}
export function surfaceOpacity(layer: SurfaceLayer,time:number) { return time<layer.start?0:numberAt(layer.opacity,time,1); }
