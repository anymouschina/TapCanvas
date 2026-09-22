import type { Engine } from '../engine.ts';
import type { Project } from '../model.ts';
import type { exportVideo } from '../export.ts';
import { jobFrames, type ExportJob } from './plan.ts';

export interface ExportDestination {
    open(job: ExportJob): Promise<FileSystemFileHandle | undefined>;
    save(job: ExportJob, blob: Blob | null): Promise<string>;
    discard?(): Promise<void>;
}
/** Serial rendering bounds memory to one video. The workspace, history and active scene stay untouched.
 * Caller holds the application's busy lock for the entire batch, including file pickers and restoration. */
export async function runVideoExports(engine: Engine, jobs: ExportJob[], projectFor: (id: string) => Project,
    destination: ExportDestination, signal: AbortSignal,
    progress: (job: ExportJob, index: number, fraction: number) => void,
    completed: (job: ExportJob, filename: string) => void,
    encode: typeof exportVideo) {
    if (engine.exporting || engine.dragging || engine.drawingPath || engine.disposed) throw Error('请先结束当前编辑或导出操作');
    const original = { project: engine.project, time: engine.time, preview: engine.previewId,
        selected: engine.selected, point: engine.selectedPoint, monochrome: engine.monochrome };
    const total = jobs.reduce((sum, job) => sum + jobFrames(job), 0);
    let frames = 0, changedScene = false;
    try {
        for (const [index, job] of jobs.entries()) {
            signal.throwIfAborted();
            progress(job, index, frames / total);
            const project = projectFor(job.sceneId);
            await engine.externalModels.prepare(project, signal);
            signal.throwIfAborted();
            changedScene = true;
            engine.previewId = 'program';
            engine.rebuild(project);
            try {
                const handle = await destination.open(job);
                signal.throwIfAborted();
                const blob = await encode(engine, job.options, signal,
                    p => progress(job, index, (frames + p * jobFrames(job)) / total), handle);
                // Streaming output is already finalized; record it even if cancellation arrives during save.
                if (blob) signal.throwIfAborted();
                const filename = await destination.save(job, blob);
                completed(job, filename);
            } catch (error) {
                await destination.discard?.().catch(() => {});
                throw error;
            }
            frames += jobFrames(job);
        }
    } finally {
        engine.previewId = original.preview;
        engine.monochrome = original.monochrome;
        try {
            if (changedScene) engine.rebuild(original.project);
            engine.select(original.selected, original.point);
        } finally { engine.restorePreview(original.time); }
    }
}
