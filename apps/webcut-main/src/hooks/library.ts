import { computed, watch, ref, onMounted } from 'vue';
import { getProject, addFile, addFileToProject, removeFileFromProject, getAllFiles } from '../db';
import { useWebCutContext } from './index';
import { source } from 'fods';
import { useSource } from 'fods-vue';
import { getFileMd5 } from '../libs/file';
import { authFetch } from '../libs/auth';
const VITE_API_BASE = import.meta.env.VITE_API_BASE;
const getProjectData = source((projectId: string) => getProject(projectId));
const getFiles = source<{ id: string; type: string; name: string; size: number, time: number }[], []>(async () => {
    const allFiles = await getAllFiles();
    return allFiles;
});

type RemoteAsset = {
    id: string;
    name: string;
    type: 'image' | 'video';
    url: string;
    thumbnailUrl?: string | null;
    time?: number;
    remote: true;
};

const remoteAssets = ref<RemoteAsset[]>([]);
const remoteAssetsLoading = ref(false);
const remoteAssetsCursor = ref<string | null>(null);
const remoteAssetsHasMore = ref(true);
const REMOTE_PAGE_SIZE = 10;
const API_BASE = VITE_API_BASE || 'https://hono-api.beqlee.icu';

function normalizeRemoteAsset(raw: any): RemoteAsset | null {
    if (!raw || typeof raw !== 'object') return null;
    const data = (raw.data || {}) as any;
    const url = typeof data.url === 'string' ? data.url : null;
    const typeRaw = typeof data.type === 'string' ? data.type.toLowerCase() : null;
    const kind = typeRaw === 'image' || typeRaw === 'video' ? typeRaw : null;
    const inferredType = kind || (url && /\.(mp4|mov|webm)(\?|$)/i.test(url) ? 'video' : url ? 'image' : null);
    if (!url || !inferredType) return null;

    let time: number | undefined;
    if (typeof raw.createdAt === 'string') {
        const parsed = Date.parse(raw.createdAt);
        time = Number.isNaN(parsed) ? undefined : parsed;
    }

    return {
        id: String(raw.id || ''),
        name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : '未命名资产',
        type: inferredType as 'image' | 'video',
        url,
        thumbnailUrl: typeof data.thumbnailUrl === 'string' ? data.thumbnailUrl : null,
        time,
        remote: true as const,
    };
}

async function fetchRemoteAssets(reset = false) {
    if (remoteAssetsLoading.value) {
        return;
    }
    if (!remoteAssetsHasMore.value && !reset) {
        return;
    }
    remoteAssetsLoading.value = true;
    try {
        const qs = new URLSearchParams();
        qs.set('limit', String(REMOTE_PAGE_SIZE));
        if (!reset && remoteAssetsCursor.value) {
            qs.set('cursor', remoteAssetsCursor.value);
        }
        const url = `${API_BASE}/assets?${qs.toString()}`;
        const res = await authFetch(url);
        if (!res.ok) {
            if (res.status === 401 && typeof window !== 'undefined') {
                try {
                    const redirect = encodeURIComponent(window.location.href);
                    const loginUrl = `${API_BASE.replace(/\/+$/, '')}/auth/session?redirect=${redirect}`;
                    window.location.href = loginUrl;
                    return;
                }
                catch {
                    // ignore redirect errors
                }
            }
            throw new Error(`list assets failed: ${res.status}`);
        }
        const json = await res.json().catch(() => ({ items: [], cursor: null }));
        const itemsRaw = Array.isArray(json?.items) ? json.items : [];
        const normalized = itemsRaw.map(normalizeRemoteAsset).filter((v): v is RemoteAsset => !!v);
        normalized.sort((a, b) => (b.time || 0) - (a.time || 0));

        if (reset) {
            remoteAssets.value = normalized;
        } else {
            const existingIds = new Set(remoteAssets.value.map(a => a.id));
            const merged = [...remoteAssets.value, ...normalized.filter(a => !existingIds.has(a.id))];
            merged.sort((a, b) => (b.time || 0) - (a.time || 0));
            remoteAssets.value = merged;
        }

        remoteAssetsCursor.value = json?.cursor ?? null;
        remoteAssetsHasMore.value = Boolean(remoteAssetsCursor.value);
    }
    catch (err) {
        console.error('[webcut] fetch remote assets failed', err);
        remoteAssetsHasMore.value = false;
    }
    finally {
        remoteAssetsLoading.value = false;
    }
}

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

    onMounted(() => {
        fetchRemoteAssets(true).catch(() => {});
    });

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
        remoteAssets,
        remoteAssetsLoading,
        remoteAssetsHasMore,
        loadMoreRemoteAssets: () => fetchRemoteAssets(false),
        refreshRemoteAssets: () => fetchRemoteAssets(true),
    };
}
