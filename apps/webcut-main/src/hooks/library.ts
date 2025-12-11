import { computed, watch } from 'vue';
import { getProject, addFile, addFileToProject, removeFileFromProject, getAllFiles } from '../db';
import { useWebCutContext } from './index';
import { source } from 'fods';
import { useSource } from 'fods-vue';
import { getFileMd5 } from '../libs/file';

const getProjectData = source((projectId: string) => getProject(projectId));
const getFiles = source<{ id: string; type: string; name: string; size: number, time: number }[], []>(async () => {
    const allFiles = await getAllFiles();
    return allFiles;
});

export function useWebCutLibrary() {
    const { id: projectId, loading } = useWebCutContext();
    const { data: projectData, init: initProjectData, refresh: refreshProjectData } = useSource(getProjectData, {});
    const { data: files, init: initFiles, refresh: refreshFiles } = useSource(getFiles, []);

    const projectFiles = computed(() => {
        const fileMetas: { id: string; time: number }[] = projectData.value?.files || [];
        return files.value.filter((item: any) => fileMetas.some((meta: any) => meta.id === item.id));
    });

    watch(projectId, () => {
        if (!projectId.value) {
            return;
        }
        initProjectData(projectId.value);
        initFiles();
    }, { immediate: true });

    async function addNewFile(file: File) {
        loading.value = true;
        try {
            let fileId = await getFileMd5(file);
            if (projectFiles.value.some((item: any) => item.id === fileId)) {
                return;
            }
            if (!files.value.some((item: any) => item.id === fileId)) {
                await addFile(file);
            }
            await addFileToProject(projectId.value, fileId);
            await refreshProjectData();
            await refreshFiles();
        } finally {
            loading.value = false;
        }
    }

    async function removeFile(fileId: string) {
        loading.value = true;
        try {
            await removeFileFromProject(projectId.value, fileId);
            await refreshProjectData();
            await refreshFiles();
        } finally {
            loading.value = false;
        }
    }

    return {
        projectId,
        projectData,
        projectFiles,
        files,
        addNewFile,
        removeFile,
    };
}
