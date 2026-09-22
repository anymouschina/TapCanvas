import {TimelineVideoFrames} from './video-frames.ts';
import * as T from 'three';
import type { CanvasSink, Input, BlobSource } from 'mediabunny';
import { mediaBlob } from './source.ts';
import { mediaTime, type MediaResource, type SurfaceLayer } from './model.ts';

interface Source {resource:MediaResource; ready:Promise<void>; input?:Input<BlobSource>; image?:ImageBitmap; error?:Error}
interface Playback {source:Source; texture:T.CanvasTexture<HTMLCanvasElement|OffscreenCanvas>; canvas:HTMLCanvasElement; sink?:CanvasSink; reader?:TimelineVideoFrames; copiedAt?:number; ready:Promise<void>; time:number; wanted:number; pending?:Promise<void>; disposed:boolean; error?:Error}
/** One decoded source per resource and one texture per distinct video clock, shared across surfaces. */
export class MediaTexturePool {
    maxEdge=2048;
    private sources=new Map<string,Source>();
    private playback=new Map<string,Playback>();
    private active=new Set<string>();
    private invalidate:()=>void;
    constructor(invalidate:()=>void){this.invalidate=invalidate;}
    begin(){this.active.clear();}
    get(resource:MediaResource,layer:SurfaceLayer):Playback {
        const key=resource.mime.startsWith('image/')?resource.id+':'+this.maxEdge:JSON.stringify([resource.id,layer.start,layer.trimIn,layer.trimOut,layer.speed,layer.loop,layer.timeOffset??0,this.maxEdge]);
        this.active.add(key);
        const cached=this.sources.get(resource.id),old=cached?.resource;
        if(cached&&old&&(old.data!==resource.data||old.mime!==resource.mime||old.width!==resource.width||old.height!==resource.height||old.duration!==resource.duration)){
            for(const [id,p]of this.playback)if(p.source===cached){p.disposed=true;p.reader?.dispose();p.texture.dispose();this.playback.delete(id);}
            void cached.ready.then(()=>{cached.image?.close();cached.input?.dispose();});this.sources.delete(resource.id);
        }
        const existing=this.playback.get(key);if(existing)return existing;
        let source=this.sources.get(resource.id);
        if(!source){source={resource:{...resource},ready:Promise.resolve()};const owner=source;
            owner.ready=(async()=>{const blob=await mediaBlob(resource);if(resource.mime.startsWith('image/'))owner.image=await createImageBitmap(blob);else{const {Input,BlobSource,ALL_FORMATS}=await import('mediabunny');owner.input=new Input({source:new BlobSource(blob),formats:ALL_FORMATS});}})().catch(e=>{owner.error=e instanceof Error?e:Error(String(e));});
            this.sources.set(resource.id,owner);
        }
        const canvas=document.createElement('canvas');const ratio=Math.min(1,this.maxEdge/Math.max(resource.width,resource.height));canvas.width=Math.max(1,Math.round(resource.width*ratio));canvas.height=Math.max(1,Math.round(resource.height*ratio));
        const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;texture.generateMipmaps=false;texture.minFilter=T.LinearFilter;
        const p:Playback={source,canvas,texture,ready:Promise.resolve(),time:-1,wanted:0,disposed:false};
        p.ready=(async()=>{await source.ready;if(source.error)throw source.error;if(p.disposed)return;
            if(source.image){canvas.getContext('2d')!.drawImage(source.image,0,0,canvas.width,canvas.height);texture.needsUpdate=true;this.invalidate();}
            else {const {CanvasSink}=await import('mediabunny');const track=await source.input!.getPrimaryVideoTrack();if(!track||!await track.canDecode())throw Error('无法解码视频：'+resource.name);// Canvas surface playback benefits from low-latency software decoding on supported codecs:
                // it avoids periodic hardware decoder / canvas synchronization stalls. GPU rendering stays enabled.
                let software=false;const config=await track.getDecoderConfig();
                if(config&&typeof VideoDecoder!=='undefined')try{software=(await VideoDecoder.isConfigSupported({...config,hardwareAcceleration:'prefer-software'})).supported===true;}catch{/* Use the platform's default decoder when unsupported. */}
                p.sink=new CanvasSink(track,{width:canvas.width,height:canvas.height,fit:'fill',poolSize:2,decoderOptions:{optimizeForLatency:true,hardwareAcceleration:software?'prefer-software':'no-preference'}});p.reader=new TimelineVideoFrames(p.sink);}
        })().catch(e=>{p.error=e instanceof Error?e:Error(String(e));});
        this.playback.set(key,p);return p;
    }
    request(p:Playback,time:number){
        p.wanted=time;if(p.pending||p.disposed||p.error||p.source.resource.mime.startsWith('image/')||Math.abs(p.time-time)<.000001)return;
        p.pending=(async()=>{await p.ready;if(p.error)throw p.error;
            while(!p.disposed&&Math.abs(p.time-p.wanted)>.000001){const at=p.wanted;const frame=await p.reader!.frameAt(at);if(p.disposed)return;
                if(p.copiedAt!==(frame?.timestamp??-1)){
                    // The reader retains current + look-ahead canvases. Upload its current
                    // canvas directly instead of copying every full-resolution video frame.
                    p.texture.image=frame?.canvas??p.canvas;p.copiedAt=frame?.timestamp??-1;p.texture.needsUpdate=true;this.invalidate();
                }
                p.time=at;
            }
        })().catch(e=>{if(!p.disposed)p.error=e instanceof Error?e:Error(String(e));}).finally(()=>{p.pending=undefined;});
    }
    sample(resource:MediaResource,layer:SurfaceLayer,time:number){const p=this.get(resource,layer);this.request(p,mediaTime(layer,resource,time)??layer.trimIn);return p.texture;}
    async prepare(){await Promise.all([...this.active].map(async key=>{const p=this.playback.get(key);if(!p)return;await p.ready;await p.pending;if(p.error)throw p.error;}));}
    end(){for(const [key,p] of this.playback)if(!this.active.has(key)){p.disposed=true;p.reader?.dispose();p.texture.dispose();this.playback.delete(key);}
        const used=new Set([...this.playback.values()].map(p=>p.source.resource.id));for(const [id,s]of this.sources)if(!used.has(id)){void s.ready.then(()=>{s.image?.close();s.input?.dispose();});this.sources.delete(id);}}
    dispose(){this.active.clear();this.end();}
    statistics(){return {sources:this.sources.size,textures:this.playback.size,pending:[...this.playback.values()].filter(p=>p.pending).length,seeks:[...this.playback.values()].reduce((n,p)=>n+(p.reader?.seeks??0),0),decodedFrames:[...this.playback.values()].reduce((n,p)=>n+(p.reader?.frames??0),0),errors:[...this.playback.values()].flatMap(p=>p.error?[p.error.message]:[])};}
}
