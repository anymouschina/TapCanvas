import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality, StreamTarget, WebMOutputFormat, canEncodeVideo } from 'mediabunny';
import type { Engine } from './engine.ts';
import { FRAME_RATES, getFrameCount } from './model.ts';
export interface ExportOptions {
    start: number;
    end: number;
    fps: number;
    width: number;
    height: number;
    cameraId: string;
    format: 'mp4' | 'webm';
    monochrome: boolean;
}
export async function exportVideo(engine: Engine, options: ExportOptions, signal: AbortSignal, progress: (p: number) => void, handle?: FileSystemFileHandle) {
    if (engine.exporting)
        throw new Error('正在导出，请等待完成');
    if (engine.dragging || engine.drawingPath || engine.disposed)
        throw new Error('请先结束当前编辑操作');
    if (![options.start, options.end, options.fps, options.width, options.height].every(Number.isFinite) || !FRAME_RATES.includes(options.fps) ||
        ![options.width, options.height].every(n => Number.isInteger(n) && n > 0 && n % 2 === 0) || !['mp4', 'webm'].includes(options.format))
        throw new Error('导出规格无效：请使用有效时间、支持的帧率和正偶数分辨率');
    if (options.cameraId !== 'program' && !engine.project.entities.some(e => e.id === options.cameraId && e.kind === 'camera')) throw new Error('导出摄影机不存在');
    if (options.end <= options.start || options.start < 0 || options.end > engine.project.duration + .00001)
        throw new Error('导出范围必须在场景时间内，且结束晚于开始');
    const codec = options.format === 'mp4' ? 'avc' : 'vp9';
    const quality = new Quality({ bitrate: Math.max(2000000, Math.round(options.width * options.height * options.fps * .13)) });
    signal.throwIfAborted();
    const originalTime = engine.time, oldMono = engine.monochrome;
    engine.exporting = true;
    engine.monochrome = options.monochrome;
    let output: Output | undefined;
    let writable: FileSystemWritableFileStream | undefined;
    try {
        // Reserve the renderer before the asynchronous encoder probe.
        if (!await canEncodeVideo(codec, { width: options.width, height: options.height, quality, latencyMode: 'quality' }))
            throw new Error(`当前浏览器不能编码此 ${options.format.toUpperCase()} 规格。请明确选择其他格式或较小分辨率后重试。`);
        signal.throwIfAborted();
        await engine.prepareOutput(options.start,signal);
        const canvas = engine.renderOutput(options.start, options.width, options.height, options.cameraId);
        writable = handle ? await handle.createWritable() : undefined;
        const target = writable ? new StreamTarget(writable) : new BufferTarget();
        output = new Output({ format: options.format === 'mp4' ? new Mp4OutputFormat() : new WebMOutputFormat(), target });
        const source = new CanvasSource(canvas, { codec, quality, latencyMode: 'quality', keyFrameInterval: 1 });
        output.addVideoTrack(source, { frameRate: options.fps });
        await output.start();
        const total = getFrameCount(options.start, options.end, options.fps);
        for (let i = 0; i < total; i++) {
            if (signal.aborted)
                throw new DOMException('已取消导出', 'AbortError');
            await engine.prepareOutput(options.start+i/options.fps,signal);
            engine.renderOutput(options.start + i / options.fps, options.width, options.height, options.cameraId);
            await source.add(i / options.fps, 1 / options.fps);
            if (i % 3 === 0 || i === total - 1) {
                progress((i + 1) / total);
                await new Promise<void>(r => setTimeout(r, 0));
            }
        }
        source.close();
        signal.throwIfAborted();
        await output.finalize();
        return target instanceof BufferTarget ? new Blob([target.buffer!], { type: options.format === 'mp4' ? 'video/mp4' : 'video/webm' }) : null;
    }
    catch (error) {
        try {
            if (output && output.state !== 'finalized' && output.state !== 'canceled')
                await output.cancel();
            else if (writable)
                await writable.abort();
        }
        catch { }
        throw error;
    }
    finally {
        engine.monochrome = oldMono;
        engine.restorePreview(originalTime);
    }
}
