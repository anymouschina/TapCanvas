import type { MediaResource } from './model.ts';

/** Decode large embedded files in bounded chunks, yielding between chunks for editor input. */
export async function mediaBlob(resource: MediaResource) {
    const encoded=resource.data.slice(resource.data.indexOf(',')+1),chunks:Uint8Array<ArrayBuffer>[]=[];
    const native=(Uint8Array as unknown as {fromBase64?:(value:string)=>Uint8Array<ArrayBuffer>}).fromBase64;
    for(let at=0;at<encoded.length;at+=1048576){const piece=encoded.slice(at,at+1048576);
        if(native)chunks.push(native(piece));else{const raw=atob(piece),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);chunks.push(bytes);}
        if(at+1048576<encoded.length)await new Promise<void>(resolve=>setTimeout(resolve,0));
    }
    return new Blob(chunks,{type:resource.mime});
}
export async function importMedia(file: File): Promise<MediaResource> {
    if(!['image/png','image/jpeg','image/webp','video/mp4','video/webm'].includes(file.type))throw Error('支持 PNG、JPEG、WebP、MP4、WebM');
    if(file.size>512*1024*1024)throw Error('单个媒体请小于 512 MB；建议先裁剪视频');
    let width=0,height=0,duration=0;
    if(file.type.startsWith('image/')) { const image=await createImageBitmap(file);width=image.width;height=image.height;image.close(); }
    else {
        const {Input,BlobSource,ALL_FORMATS}=await import('mediabunny');const input=new Input({source:new BlobSource(file),formats:ALL_FORMATS});
        try {const track=await input.getPrimaryVideoTrack();if(!track||!await track.canDecode())throw Error('此视频编码无法解码，请转为 H.264 MP4 或 VP9 WebM');width=track.displayWidth;height=track.displayHeight;duration=await input.computeDuration([track]);}
        finally{input.dispose();}
    }
    if(width>16384||height>16384||!width||!height)throw Error('媒体尺寸无效或超过 16384 像素');
    const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
    const id='media-'+[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
    const data=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(r.error);r.readAsDataURL(file);});
    return {id,name:file.name.slice(0,200),mime:file.type,data,width,height,duration};
}
