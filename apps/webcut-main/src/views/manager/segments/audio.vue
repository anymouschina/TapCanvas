<script setup lang="ts">
import { AudioClip } from '@webav/av-cliper';
import { WebCutSegment, WebCutRail } from '../../../types';
import { computed, onMounted, ref } from 'vue';
import { useWebCutContext } from '../../../hooks';
import { useT } from '../../../hooks/i18n';
import { exportAsWavBlobOffscreen } from '../../../libs';
import { downloadBlob } from '../../../libs/file';
import { useWebCutManager } from '../../../hooks/manager';
import AudioShape from '../../../components/audio-shape/index.vue';
import { useScrollBox } from '../../../components/scroll-box';
import ContextMenu from '../../../components/context-menu/index.vue';
import { useWebCutHistory } from '../../../hooks/history';
import { watch } from 'vue';

const t = useT();
const props = defineProps<{
    segment: WebCutSegment;
    rail: WebCutRail;
    railIndex: number;
    segmentIndex: number;
    segments: WebCutSegment[]
}>();

const { sources } = useWebCutContext();
const { timeToPx, deleteSegment } = useWebCutManager();
const scrollBox = useScrollBox();
const { push: pushHistory } = useWebCutHistory();

const source = computed(() => {
    const key = props.segment.sourceKey;
    const source = sources.value.get(key);
    return source;
});
// 总宽度
const width = computed(() => {
    const duration = props.segment.end - props.segment.start;
    return timeToPx(duration);
});
const audioF32 = ref<Float32Array>();

watch(source, async () => {
    if (!source.value) return;
    const { clip } = source.value;
    if (!clip) return;
    await clip.ready;
    // 一次性加载波形图
    audioF32.value = (clip as AudioClip).getPCMData()[0];
}, { immediate: true });

const visibleRange = ref<[number, number]>([0, 0]);
function updateVisibleRange() {
    const start = timeToPx(props.segment.start);
    const end = timeToPx(props.segment.end);

    const scrollOffset = scrollBox.getScrollOffset();
    const scrollContentSize = scrollBox.getScrollContainerSize();
    const { left: scrollLeft } = scrollOffset;
    const { width: scrollContentWidth } = scrollContentSize;

    if (scrollLeft + scrollContentWidth <= start || scrollLeft > end) {
        visibleRange.value = [0, 0];
        return;
    }

    const left = Math.max(scrollLeft - start, 0);
    const width = Math.min(end - start, scrollContentWidth);
    const right = left + width;
    visibleRange.value = [left, right];
}
onMounted(updateVisibleRange);
onMounted(() => {
    scrollBox.onScroll(updateVisibleRange);
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

            const clip = sourceInfo.clip as AudioClip;
            await clip.ready;

            const blob = await exportAsWavBlobOffscreen([clip]);
            downloadBlob(blob, `audio-segment-${Date.now()}.wav`);
        } catch (error) {
            console.error('导出失败:', error);
        }
    }
}

const data = computed(() => {
    return source.value?.fileId || source.value?.clip as AudioClip || audioF32.value || null;
});
</script>

<template>
    <context-menu :options="contextmenus" auto-hide v-slot="{ showContextMenus }" @select="handleSelectContextMenu">
        <div class="webcut-audio-segment" @contextmenu.capture.stop="showContextMenus">
            <audio-shape
                :height="20"
                :width="width"
                :data="data"
                :visible-range="visibleRange"
                class="webcut-audio-segment-canvas"
                v-if="source || audioF32"
            />
        </div>
    </context-menu>
</template>

<style socped>
.webcut-audio-segment {
    position: relative;
    height: 100%;
}
.webcut-audio-segment-canvas {
    position: absolute;
    top: 50%;
    left: 0;
    transform: translateY(-50%);
}
</style>