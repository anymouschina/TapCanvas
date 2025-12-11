import { readFile } from '../db';
import { ref } from 'vue';

const fileCacheSet = ref<any>({});

export function useWebCutLocalFile() {
    async function applyFileUrl(fileId: string) {
        const fileCache = fileCacheSet.value[fileId];
        if (fileCache?.url) {
            return fileCache.url;
        }

        if (fileCache?.ready) {
            return await fileCache.ready;
        }

        let resolve, reject;
        const ready = new Promise((ro, rj) => {
            resolve = ro;
            reject = rj;
        });
        ready.catch(() => {});
        fileCacheSet.value[fileId] = {
            ready,
        };
        try {
            const file = await readFile(fileId);
            if (!file) {
                reject!(new Error('File not found'));
                return;
            }
            const fileCache = fileCacheSet.value[fileId];
            fileCache.url = URL.createObjectURL(file);
            resolve!(fileCache.url);
            return fileCache.url;
        }
        catch (err) {
            reject!(err);
        }
    }

    function fileUrl(fileId: string) {
        const fileCache = fileCacheSet.value[fileId];
        if (fileCache?.url) {
            return fileCache.url;
        }
        applyFileUrl(fileId);
    }

    return {
        applyFileUrl,
        fileUrl,
        readFile,
    };
}
