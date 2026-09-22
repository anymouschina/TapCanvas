import * as T from 'three';
import type { SurfaceLayer } from './model.ts';
/** Crop and rotate a projector image in one retained canvas; redraw only when pixels or placement change. */
export class ProjectionTexture {
    private canvas=document.createElement('canvas');
    private tileCanvas=document.createElement('canvas');
    readonly texture=new T.CanvasTexture(this.canvas);
    private version=-1;private key='';private source:T.Texture|null=null;
    constructor(){this.canvas.width=this.canvas.height=this.tileCanvas.width=this.tileCanvas.height=1024;this.texture.colorSpace=T.SRGBColorSpace;this.texture.generateMipmaps=false;this.texture.minFilter=T.LinearFilter;}
    update(source:T.Texture,layer:SurfaceLayer,opacity:number){const key=JSON.stringify([layer.crop,layer.offset,layer.repeat,layer.rotation,layer.fit,layer.tile,opacity]);if(source===this.source&&source.version===this.version&&key===this.key)return this.texture;
        this.source=source;this.version=source.version;this.key=key;const image=source.image as HTMLCanvasElement,ctx=this.canvas.getContext('2d')!,[x,y,w,h]=layer.crop;
        ctx.save();ctx.fillStyle='black';ctx.fillRect(0,0,1024,1024);ctx.globalAlpha=opacity;ctx.translate(512+layer.offset[0]*1024,512+layer.offset[1]*1024);ctx.rotate(layer.rotation*Math.PI/180);ctx.scale(...layer.repeat);
        const aspect=image.width*w/(image.height*h),fit=layer.fit;let width=1024,height=1024;if(fit==='contain'){width=1024*Math.min(1,aspect);height=1024*Math.min(1,1/aspect);}if(fit==='cover'){width=1024*Math.max(1,aspect);height=1024*Math.max(1,1/aspect);}
        if(layer.tile){
            const tile=this.tileCanvas.getContext('2d')!;tile.clearRect(0,0,1024,1024);tile.drawImage(image,x*image.width,y*image.height,w*image.width,h*image.height,0,0,1024,1024);
            ctx.translate(-width/2,-height/2);ctx.scale(width/1024,height/1024);ctx.fillStyle=ctx.createPattern(this.tileCanvas,'repeat')!;
            const inverse=ctx.getTransform().inverse(),corners=[[0,0],[1024,0],[0,1024],[1024,1024]].map(([x,y])=>inverse.transformPoint({x,y}));
            const left=Math.min(...corners.map(p=>p.x)),top=Math.min(...corners.map(p=>p.y));ctx.fillRect(left,top,Math.max(...corners.map(p=>p.x))-left,Math.max(...corners.map(p=>p.y))-top);
        }else ctx.drawImage(image,x*image.width,y*image.height,w*image.width,h*image.height,-width/2,-height/2,width,height);
        ctx.restore();this.texture.needsUpdate=true;return this.texture;
    }
    dispose(){this.texture.dispose();this.canvas.width=this.canvas.height=this.tileCanvas.width=this.tileCanvas.height=1;}
}
