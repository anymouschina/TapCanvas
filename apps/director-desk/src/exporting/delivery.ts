import { download } from '../storage.ts';
import { numberedFilename, type ExportJob } from './plan.ts';
import type { ExportDestination } from './batch.ts';

export type SaveMode = 'default' | 'download' | 'disk' | 'directory';
interface Pickers {
    showSaveFilePicker(options: unknown): Promise<FileSystemFileHandle>;
    showDirectoryPicker(options: unknown): Promise<FileSystemDirectoryHandle>;
}
export async function videoDestination(mode: SaveMode, jobs: ExportJob[]): Promise<ExportDestination> {
    const pickers = window as unknown as Pickers;
    const single = mode === 'disk' ? await pickers.showSaveFilePicker({ suggestedName: jobs[0].filename,
        types: [{ description: '参考视频', accept: { [jobs[0].options.format === 'mp4' ? 'video/mp4' : 'video/webm']: ['.' + jobs[0].options.format] } }] }) : undefined;
    const directory = mode === 'directory' ? await pickers.showDirectoryPicker({ mode: 'readwrite' }) : undefined;
    let actualName = '', created = false;
    return {
        async open(job) {
            actualName = single?.name ?? job.filename;
            if (!directory) return single;
            // Avoid replacing files already present in the chosen folder.
            for (let index = 1; ; index++) {
                actualName = numberedFilename(job.filename, index);
                try { await directory.getFileHandle(actualName); }
                catch (error) {
                    if ((error as Error).name === 'NotFoundError') {
                        const handle = await directory.getFileHandle(actualName, { create: true });
                        created = true; return handle;
                    }
                    if ((error as Error).name !== 'TypeMismatchError') throw error;
                }
            }
        },
        async save(job, blob) {
            if (blob && mode === 'default') {
                if (!window.directorDesktop?.files) throw Error('桌面文件服务不可用');
                const result = await window.directorDesktop.files('save-export', { name: job.filename, bytes: await blob.arrayBuffer() });
                if (!result.ok || !result.data?.saved) throw Error(result.error || '视频保存失败');
                return result.data.filename ?? job.filename;
            }
            if (blob) download(blob, job.filename);
            created = false;
            return actualName;
        },
        async discard() {
            if (created && directory) { await directory.removeEntry(actualName); created = false; }
        },
    };
}
