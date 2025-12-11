<script setup lang="ts">
import { ImgClip } from '@webav/av-cliper';
import { WebCutSegment, WebCutRail } from '../../../types';
import { computed } from 'vue';
import { useWebCutContext } from '../../../hooks';
import { useT } from '../../../hooks/i18n';

const t = useT();
import { useWebCutLocalFile } from '../../../hooks/local-file';
import { useWebCutManager } from '../../../hooks/manager';
import ContextMenu from '../../../components/context-menu/index.vue';
import { useWebCutHistory } from '../../../hooks/history';
import { downloadBlob } from '../../../libs/file';

const props = defineProps<{
    segment: WebCutSegment;
    rail: WebCutRail;
    railIndex: number;
    segmentIndex: number;
    segments: WebCutSegment[]
}>();

const { fileUrl } = useWebCutLocalFile();
const { sources } = useWebCutContext();
const { deleteSegment } = useWebCutManager();
const { push: pushHistory } = useWebCutHistory();

const source = computed(() => {
    const key = props.segment.sourceKey;
    const source = sources.value.get(key);
    return source;
});

const contextmenus = computed(() => [
    {
        label: t('删除'),
        key: 'delete',
    },
    {
        label: t('导出'),
        key: 'export',
    },
]);

async function handleSelectContextMenu(key: string) {
    if (key === 'delete') {
        deleteSegment({ segment: props.segment, rail: props.rail });
        await pushHistory();
    } else if (key === 'export') {
        try {
            const sourceInfo = sources.value.get(props.segment.sourceKey);
            if (!sourceInfo || !sourceInfo.clip) return;

            const clip = sourceInfo.clip as ImgClip;
            await clip.ready;

            const { video } = await clip.tick(1);
            if (!video) return;

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d')!;
            if (video instanceof VideoFrame) {
                // 从 VideoFrame 提取图像数据
                canvas.width = video.codedWidth;
                canvas.height = video.codedHeight;
                ctx.drawImage(video, 0, 0);
            }
            else if (video instanceof ImageBitmap) {
                // 从 ImageBitmap 提取图像数据
                canvas.width = video.width;
                canvas.height = video.height;
                ctx.drawImage(video, 0, 0);
            }
            else {
                return;
            }
            canvas.toBlob((blob: Blob | null) => {
                if (!blob) return;
                downloadBlob(blob, `image-segment-${Date.now()}-${canvas.width}x${canvas.height}.png`);
            }, 'image/png');
        } catch (error) {
            console.error('导出失败:', error);
        }
    }
}
</script>

<template>
    <context-menu :options="contextmenus" auto-hide v-slot="{ showContextMenus }" @select="handleSelectContextMenu">
        <div class="webcut-image-segment" @contextmenu.capture.stop="showContextMenus" :style="{
            backgroundImage: `url(${source?.fileId ? fileUrl(source?.fileId) : source?.url})`
        }">
        </div>
    </context-menu>
</template>

<style scoped>
.webcut-image-segment {
    height: 100%;
    width: 100%;
    background-repeat: repeat-x;
    background-size: contain;
}
</style>