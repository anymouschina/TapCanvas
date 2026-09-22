import { FRAME_RATES, getFrameCount, outputSize, type Project } from '../model.ts';
import { safeFilename } from '../production/notes.ts';
import type { ExportOptions } from '../export.ts';

export interface ExportScene { id: string; name: string; duration: number; fps: number; aspect: Project['aspect'] }
export interface ExportSelection { sceneId: string; filename: string }
export interface VideoSettings { size: number; fps: number | 'scene'; format: 'mp4' | 'webm'; monochrome: boolean }
export interface ExportJob { sceneId: string; sceneName: string; filename: string; options: ExportOptions }

export function videoFilename(value: string, format: VideoSettings['format']) {
    return safeFilename(value.trim().replace(/\.(mp4|webm)$/i, '').replace(/^[. ]+/, '')) + '.' + format;
}
export function numberedFilename(filename: string, index: number) {
    return index === 1 ? filename : filename.replace(/(\.[^.]+)$/, ` (${index})$1`);
}
/** A small export plan contains no model packages or mutable editor state. */
export function planVideoExports(scenes: ExportScene[], selections: ExportSelection[], settings: VideoSettings,
    range?: { start: number; end: number; cameraId: string }): ExportJob[] {
    if (!selections.length) throw Error('请至少选择一个戏段');
    if (![640, 1280, 1920].includes(settings.size) || !['mp4', 'webm'].includes(settings.format)
        || (settings.fps !== 'scene' && !FRAME_RATES.includes(settings.fps))) throw Error('导出规格无效');
    if (range && selections.length !== 1) throw Error('自定义范围仅适用于单个戏段');
    const names = new Set<string>(), ids = new Set<string>();
    return selections.map(selection => {
        const scene = scenes.find(s => s.id === selection.sceneId);
        if (!scene || ids.has(scene.id)) throw Error('戏段不存在或重复');
        ids.add(scene.id);
        if (!selection.filename.trim()) throw Error(`请填写“${scene.name}”的输出文件名`);
        const base = videoFilename(selection.filename, settings.format);
        let filename = base, suffix = 1;
        while (names.has(filename.toLowerCase())) filename = numberedFilename(base, ++suffix);
        names.add(filename.toLowerCase());
        const [width, height] = outputSize(scene.aspect, settings.size);
        const options: ExportOptions = { start: range?.start ?? 0, end: range?.end ?? scene.duration,
            cameraId: range?.cameraId ?? 'program', width, height, fps: settings.fps === 'scene' ? scene.fps : settings.fps,
            format: settings.format, monochrome: settings.monochrome };
        if (![options.start, options.end].every(Number.isFinite) || options.start < 0 || options.end <= options.start || options.end > scene.duration)
            throw Error(`“${scene.name}”的起止时间必须在戏段范围内`);
        return { sceneId: scene.id, sceneName: scene.name, filename, options };
    });
}
export const jobFrames = (job: ExportJob) => getFrameCount(job.options.start, job.options.end, job.options.fps);
export const estimatedVideoBytes = (job: ExportJob) => Math.max(2000000,
    job.options.width * job.options.height * job.options.fps * .13) / 8 * (job.options.end - job.options.start);
