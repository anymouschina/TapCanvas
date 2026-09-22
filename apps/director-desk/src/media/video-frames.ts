import type { CanvasSink, WrappedCanvas } from 'mediabunny';

/** Retains a decoder for nearby forward requests; arbitrary seeks restart at their keyframe. */
export class TimelineVideoFrames {
    private sink:CanvasSink;
    private iterator:AsyncGenerator<WrappedCanvas,void,unknown>|undefined;
    private current:WrappedCanvas|null=null;
    private ahead:WrappedCanvas|null=null;
    private requested=-1;
    private idle:ReturnType<typeof setTimeout>|undefined;
    private disposed=false;
    seeks=0;frames=0;
    constructor(sink:CanvasSink){this.sink=sink;}
    private async closeIterator(){const iterator=this.iterator;this.iterator=undefined;if(iterator)await iterator.return();}
    async frameAt(time:number):Promise<WrappedCanvas|null>{
        if(this.disposed)return null;
        clearTimeout(this.idle);
        // Same decoded frame needs neither another decoder nor another texture upload.
        if(this.current&&time>=this.current.timestamp&&time<this.current.timestamp+this.current.duration-1e-7){this.idle=setTimeout(()=>{void this.closeIterator().catch(()=>{});},1000);return this.current;}
        if(!this.iterator||time<this.requested-1e-7||time-this.requested>.75){
            await this.closeIterator();if(this.disposed)return null;
            this.iterator=this.sink.canvases(time);this.current=null;this.ahead=null;this.seeks++;
            const first=await this.iterator.next();if(!first.done){this.ahead=first.value;this.frames++;}
        }
        if(this.disposed)return null;const iterator=this.iterator!;
        this.requested=time;
        while(this.ahead&&this.ahead.timestamp<=time+1e-7){
            this.current=this.ahead;
            const next=await iterator.next();
            if(next.done){this.ahead=null;}else{this.ahead=next.value;this.frames++;}
        }
        // Release hardware decoder queues after a pause. Canvas pixels remain usable.
        this.idle=setTimeout(()=>{void this.closeIterator().catch(()=>{});},1000);
        if(this.disposed)return null;
        return this.current;
    }
    dispose(){this.disposed=true;clearTimeout(this.idle);void this.closeIterator().catch(()=>{});this.current=this.ahead=null;}
}
