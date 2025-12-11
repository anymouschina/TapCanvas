<script setup lang="ts">
import { MP4Clip } from '@webav/av-cliper';
import { WebCutSegment, WebCutRail } from '../../../types';
import { computed, ref, watch, onMounted, markRaw } from 'vue';
import { useWebCutContext } from '../../../hooks';
import { useT } from '../../../hooks/i18n';
import { downloadBlob } from '../../../libs/file';
import { useWebCutManager } from '../../../hooks/manager';
import ContextMenu from '../../../components/context-menu/index.vue';
import { useWebCutHistory } from '../../../hooks/history';
import { mp4ClipToFramesData, createImageFromVideoFrame, exportBlobOffscreen } from '../../../libs';
import AudioShape from '../../../components/audio-shape/index.vue';
import { useScrollBox } from '../../../components/scroll-box';
import { PerformanceMark, mark, measure } from '../../../libs/performance';

const t = useT();

// 轨道容器中图片的高度
const IMAGE_HEIGHT = 58;
const AUDIO_HEIGHT = 20;

const props = defineProps<{
    segment: WebCutSegment;
    rail: WebCutRail;
    railIndex: number;
    segmentIndex: number;
    segments: WebCutSegment[]
}>();

const { sources, scale } = useWebCutContext();
const { timeToPx, deleteSegment } = useWebCutManager();
const { push: pushHistory } = useWebCutHistory();
const scrollBox = useScrollBox();

const thumbnails = ref<{ url: string; left: number }[]>([]);
// 在轨道中渲染后每张图片的真实宽度
const sourceImageWidth = ref(0);
const sourceFrames = ref<{ ts: number; blob: Blob; offset: number }[]>([]);

const source = computed(() => sources.value.get(props.segment.sourceKey));
const totalDuration = computed(() => {
    const { sprite } = source.value || {};
    return sprite ? sprite.time.duration || 0 : 0;
});
// 容器的总宽度
const totalWidth = computed(() => {
    return timeToPx(totalDuration.value);
});

const audioF32 = ref();

watch(source, initThumbnailsAndAudioWave, { immediate: true });

watch(scale, updateThumbnails);

const createImgUrl = (imgBlob: Blob) => {
    const url = URL.createObjectURL(imgBlob);
    // 释放内存，这些图片都是一次性使用的，下次还会再生成，因此，可以立即释放
    setTimeout(() => {
        URL.revokeObjectURL(url);
    }, 1000);
    return url;
};

async function initThumbnailsAndAudioWave() {
    const { loading } = useWebCutContext();
    loading.value = true;
    try {
        if (!source.value) {
            return;
        }
        const { clip, sprite } = source.value;
        if (!clip) {
            return;
        }

        await clip.ready;
        await sprite.ready;

        const dur = sprite.time.duration;
        const totalWidth = timeToPx(dur);

        // 算出每张图片在轨道中的实际宽度
        const originalWidth = clip.meta.width || 0;
        const originalHeight = clip.meta.height || 0;
        const realWidthPerImg = IMAGE_HEIGHT * originalWidth / originalHeight;
        sourceImageWidth.value = realWidthPerImg;

        mark(PerformanceMark.GenVideoSegmentFirstThumbStart);
        let isFirstThumbGen = false;
        sourceFrames.value = [];
        // 通过iteratorCallback在迭代过程中逐一加载图片，从而提升首次渲染图片列表的性能
        const iteratorCallback = async (data: { video: VideoFrame, ts: number, index: number }) => {
            const { video, ts, index } = data;
            // 使用 JPEG 格式和 0.6 质量，大幅提升性能
            const imgBlob = await createImageFromVideoFrame(video, {
                width: realWidthPerImg,
                quality: 0.6,
                format: 'jpeg'
            });

            const offset = ts / dur;
            const frame = {
                ts,
                blob: imgBlob,
                offset,
            };
            sourceFrames.value[index] = markRaw(frame);
            video.close(); // 关闭VideoFrame

            // 第一次加载在载入缩略图
            let currEndPx = 0;
            for (let i = 0; i < sourceFrames.value.length; i ++) {
                const item = sourceFrames.value[i];
                if (!item) {
                    continue;
                }
                const itemStartPx = totalWidth * item.offset;
                if (itemStartPx < currEndPx - 4) {
                    continue;
                }
                currEndPx = itemStartPx + realWidthPerImg;

                if (i < index) {
                    continue;
                }
                const url = createImgUrl(imgBlob);
                thumbnails.value.push({
                    url,
                    left: itemStartPx,
                });
                if (!isFirstThumbGen) {
                    isFirstThumbGen = true;
                    mark(PerformanceMark.GenVideoSegmentFirstThumbEnd);
                }
            }
        }

        // PCM 渐进式回调：实时更新音频波形图
        const pcmProgressCallback = (pcm: [Float32Array, Float32Array]) => {
            const [leftChannelPCM, rightChannelPCM] = pcm;
            if (leftChannelPCM) {
                audioF32.value = leftChannelPCM;
            } else if (rightChannelPCM) {
                audioF32.value = rightChannelPCM;
            }
        };

        const { pcm } = await mp4ClipToFramesData(clip as MP4Clip, { iteratorCallback, pcmProgressCallback });
        const [leftChannelPCM, rightChannelPCM] = pcm;

        if (leftChannelPCM) {
            audioF32.value = leftChannelPCM;
        }
        else if (rightChannelPCM) {
            audioF32.value = rightChannelPCM;
        }
        else {
            audioF32.value = null;
        }

        if (import.meta.env.DEV) {
            measure(PerformanceMark.PushVideoStart, PerformanceMark.PushVideoEnd);
            measure(PerformanceMark.GenVideoClipStart, PerformanceMark.GenVideoClipEnd);
            measure(PerformanceMark.MeasureVideoSizeStart, PerformanceMark.MeasureVideoSizeEnd);
            measure(PerformanceMark.GenVideoClipEnd, PerformanceMark.VideoSpriteAddStart);
            measure(PerformanceMark.VideoSpriteAddStart, PerformanceMark.VideoSpriteAddEnd);
            measure(PerformanceMark.VideoSpriteAddEnd, PerformanceMark.VideoSegmentAdded);

            measure(PerformanceMark.GenVideoSegmentFirstThumbStart, PerformanceMark.GenVideoSegmentFirstThumbEnd);
            measure(PerformanceMark.ConvertMP4ClipToFramesStart, PerformanceMark.ConvertMP4ClipToFramesEnd);
            measure(PerformanceMark.GenImageFromVideoFrameStart, PerformanceMark.GenImageFromVideoFrameEnd);
        }
    }
    catch (e) {
        console.error(e);
    } finally {
        loading.value = false;
    }
}

/**
 * 通过优化的过滤算法，确保缩略图在视觉上尽可能连续拼接，同时避免过多重叠
 */
async function updateThumbnails() {
    if (!sourceFrames.value.length) {
        return;
    }

    const widthPerImage = sourceImageWidth.value;

    const outs: any[] = [{
        url: createImgUrl(sourceFrames.value[0].blob),
        left: 0,
    }];

    let currEndPx = widthPerImage;

    for (let i = 1; i < sourceFrames.value.length; i ++) {
        const item = sourceFrames.value[i];
        if (!item) {
            continue;
        }
        const itemStartPx = totalWidth.value * item.offset;
        if (itemStartPx < currEndPx - 4) {
            continue;
        }
        outs.push({
            url: createImgUrl(item.blob),
            left: itemStartPx,
        });
        currEndPx = itemStartPx + widthPerImage;
    }

    thumbnails.value = outs;
}

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

            const clip = sourceInfo.clip as MP4Clip;
            await clip.ready;

            const blob = await exportBlobOffscreen([clip]);
            downloadBlob(blob, `video-segment-${Date.now()}.mp4`);
        } catch (error) {
            console.error('导出失败:', error);
        }
    }
}

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

const filteredThumbnails = computed(() => thumbnails.value.filter(Boolean));
function calcImgWidth(thumb: { left: number }, index: number) {
    if (filteredThumbnails.value[index + 1]) {
        return filteredThumbnails.value[index + 1].left - thumb.left;
    }
    if (index === sourceFrames.value.length - 1) {
        return totalWidth.value - thumb.left;
    }
    return sourceImageWidth.value;
}
</script>

<template>
    <context-menu :options="contextmenus" auto-hide v-slot="{ showContextMenus }" @select="handleSelectContextMenu">
        <div class="webcut-video-segment" @contextmenu.capture.stop="showContextMenus" :style="{ '--segment-total-width': totalWidth + 'px', '--thumb-img-height': IMAGE_HEIGHT + 'px', '--audio-wave-height': AUDIO_HEIGHT + 'px' }">
            <div
                v-for="thumbnail,index in thumbnails.filter(Boolean)"
                :key="thumbnail.left"
                :style="{
                    left: `${thumbnail.left}px`,
                    backgroundImage: `url(${thumbnail.url})`,
                    width: calcImgWidth(thumbnail, index) + 'px',
                }"
                class="webcut-video-segment-thumbnail"
            ></div>
            <div class="webcut-video-segment-bottom" v-if="!props.rail.mute && audioF32">
                <audio-shape
                    :height="AUDIO_HEIGHT - 4"
                    :width="totalWidth"
                    :data="source?.fileId || audioF32"
                    :visible-range="visibleRange"
                    class="webcut-video-segment-audio-shape"
                />
            </div>
        </div>
    </context-menu>
</template>

<style socped>
.webcut-video-segment {
    position: relative;
    width: 100%;
    height: 100%;
}
.webcut-video-segment-thumbnail {
    position: absolute;
    top: 0;
    height: var(--thumb-img-height);
    background-repeat: repeat-x;
    background-size: auto 100%;
    opacity: 0;
    animation: webcut-video-segment-thumbnail-fade-in 0.1s ease-in-out forwards;
}
@keyframes webcut-video-segment-thumbnail-fade-in {
    to {
        opacity: 1;
    }
}
.webcut-video-segment-bottom {
    width: 100%;
    height: var(--audio-wave-height);
    width: var(--segment-total-width);
    position: absolute;
    left: 0;
    bottom: 0;
    background-color: var(--webcut-grey-color);
    opacity: .8;
}
.webcut-video-segment-audio-shape {
    margin: 2px 0;
}
</style>