import { Input, BufferSource, ALL_FORMATS } from 'mediabunny';
import { assertMediaResources, type MediaResource } from './model.ts';

/** Portable metadata reader. Decoding support is checked by the renderer when opened. */
export async function mediaFromBytes(name:string,mime:string,bytes:Uint8Array):Promise<MediaResource>{
    if(!bytes.length||bytes.length>512*1024*1024)throw Error('媒体大小必须在 0—512 MB 之间');
    let width=0,height=0,duration=0;
    const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    const text=(offset:number,length:number)=>new TextDecoder().decode(bytes.subarray(offset,offset+length));
    if(mime.startsWith('video/')){
        const input=new Input({source:new BufferSource(bytes),formats:ALL_FORMATS});
        try{const track=await input.getPrimaryVideoTrack();if(!track)throw Error('没有视频轨');width=track.displayWidth;height=track.displayHeight;duration=await input.computeDuration([track]);}finally{input.dispose();}
    }else if(mime==='image/png'&&bytes.length>=24&&bytes[0]===137&&text(1,7)==='PNG\r\n\x1a\n'){
        width=v.getUint32(16);height=v.getUint32(20);
    }else if(mime==='image/jpeg'&&bytes[0]===255&&bytes[1]===216){
        let at=2;while(at+4<=bytes.length){if(bytes[at++]!==255)break;while(bytes[at]===255)at++;const marker=bytes[at++];if(marker===217||marker===218)break;if(marker===1||marker>=208&&marker<=215)continue;
            const length=v.getUint16(at);if(length<2||at+length>bytes.length)break;
            if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&length>=8){height=v.getUint16(at+3);width=v.getUint16(at+5);break;}at+=length;
        }
    }else if(mime==='image/webp'&&text(0,4)==='RIFF'&&text(8,4)==='WEBP'){
        const kind=text(12,4);if(kind==='VP8X'&&bytes.length>=30){width=1+bytes[24]+bytes[25]*256+bytes[26]*65536;height=1+bytes[27]+bytes[28]*256+bytes[29]*65536;}
        else if(kind==='VP8 '&&bytes.length>=30){width=v.getUint16(26,true)&16383;height=v.getUint16(28,true)&16383;}
        else if(kind==='VP8L'&&bytes.length>=25&&bytes[20]===47){const bits=v.getUint32(21,true);width=(bits&16383)+1;height=((bits>>>14)&16383)+1;}
    }
    if(!width||!height)throw Error('无法读取图片尺寸或媒体格式不符');
    const owned=new Uint8Array(bytes),digest=await crypto.subtle.digest('SHA-256',owned);
    let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
    const resource={id:'media-'+[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join(''),name:name.replaceAll('\\','/').split('/').at(-1)!.slice(0,200),mime,width,height,duration,data:`data:${mime};base64,${btoa(binary)}`};
    assertMediaResources([resource]);return resource;
}
