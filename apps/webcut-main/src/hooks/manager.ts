import { computed, watchEffect, watch } from 'vue';
import { useWebCutContext, useWebCutPlayer } from './index';
import { getGridFrame, getGridPixel } from '../libs/timeline';
import { WebCutSegment, WebCutRail } from '../types';

export function useWebCutManager() {
    const {
        cursorTime, fps, scale, canvas, duration, scroll1, scroll2, status, ruler, manager, sources, updateDuration,
        // rails,
        unselectSegment,
        loading,
    } = useWebCutContext();
    const { pause, push, syncTickInterceptor } = useWebCutPlayer();

    // 同步两边scroll的滚动情况
    watchEffect(() => {
        if (!scroll1.value || !scroll2.value) {
            return;
        }

        scroll1.value.onScroll((offset: { top: number; left: number }) => {
            const offset2 = scroll2.value.getScrollOffset();
            if (offset2.top !== offset.top) {
                scroll2.value.scrollTo({ top: offset.top }, false, true);
            }
        });

        scroll2.value.onScroll((offset: { top: number; left: number }) => {
            const offset1 = scroll1.value.getScrollOffset();
            if (offset1.top !== offset.top) {
                scroll1.value.scrollTo({ top: offset.top }, false, true);
            }
        });
    });

    // 总帧数
    const totalFrameCount = computed(() => {
        const allFrames = duration.value / 1e6 * fps.value;
        return Math.ceil(allFrames);
    });

    // 总长度，像素
    const totalPx = computed(() => {
        const px = getGridPixel(scale.value, totalFrameCount.value);
        return px;
    });

    // 当前游标所在的帧坐标
    const cursorFrame = computed(() => {
        return Math.ceil(cursorTime.value / 1e6 * fps.value);
    });

    // 游标所处的位置
    const cursorPx = computed(() => {
        return getGridPixel(scale.value, cursorFrame.value);
    });

    watch([status, cursorTime], () => {
        // 从播放状态切换到其他状态
        if (status.value !== 1 && scroll2.value) {
            setTimeout(() => {
                const target = cursorPx.value;
                const outerWidth = scroll2.value.getScrollContainerSize().width;
                const to = target - outerWidth / 2;
                scroll2.value.scrollTo({ left: to }, true, true);
            }, 200);
        }
    });

    // 移动光标到时间(纳秒)
    const moveCursorToTime = (ns: number) => {
        cursorTime.value = ns;
        pause();
        canvas.value?.previewFrame(cursorTime.value);
    };

    // 移动光标到帧坐标
    const moveCursorToFrame = (frame: number) => {
        cursorTime.value = frame / fps.value * 1e6;
        pause();
        canvas.value?.previewFrame(cursorTime.value);
    };

    // 移动光标到像素坐标
    const moveCursorToPx = (offsetLeft: number) => {
        cursorTime.value = getGridFrame(offsetLeft, scale.value, fps.value) * 1e6 / fps.value;
        pause();
        canvas.value?.previewFrame(cursorTime.value);
    };

    // 时间(纳秒)转像素坐标
    const timeToPx = (ns: number) => {
        return getGridPixel(scale.value, Math.round(ns / 1e6 * fps.value));
    };

    // 像素坐标转时间(纳秒)
    const pxToTime = (px: number) => {
        return getGridFrame(px, scale.value, fps.value) / fps.value * 1e6;
    };

    // 一帧的像素长度
    const pxOf1Frame = computed(() => {
        return getGridPixel(scale.value, 1);
    });

    // 一帧的时间长度(纳秒)
    const timeOf1Frame = computed(() => {
        return 1 / fps.value * 1e6;
    });

    // 当改变sgement时间，如通过拖拽改变其大小时，要调用该函数更新
    function resetSegmentTime(segment: WebCutSegment) {
        const { sourceKey, start, end } = segment;
        const source = sources.value.get(sourceKey);
        if (!source) {
            return;
        }
        source.sprite.time.offset = start;
        source.sprite.time.duration = end - start;
        updateDuration();
    }

    function resizeManagerMaxHeight(h: number) {
        manager.value?.resizeManagerMaxHeight(h);
    }

    function toggleRailHidden(rail: WebCutRail) {
        const hidden = rail.hidden = !rail.hidden;
        const segments = rail.segments;
        for (let segment of segments) {
            const { sourceKey } = segment;
            const source = sources.value.get(sourceKey);
            if (!source) {
                continue;
            }
            source.sprite.visible = !hidden;
        }
    }

    function toggleRailMute(rail: WebCutRail) {
        rail.mute = !rail.mute;
        const segments = rail.segments;
        for (let segment of segments) {
            const { sourceKey } = segment;
            const source = sources.value.get(sourceKey);
            if (!source) {
                continue;
            }
            const clip = source.clip;
            // 使用复用的syncTickInterceptor函数
            syncTickInterceptor(clip, sourceKey);

            // 调用previewFrame立即显示效果
            canvas.value?.previewFrame(cursorTime.value);
        }
    }

    function deleteSegment({ segment, rail }: { segment: WebCutSegment; rail: WebCutRail }) {
        const { sourceKey } = segment;
        const source = sources.value.get(sourceKey);
        if (source) {
            const { clip, sprite } = source!;
            canvas.value?.removeSprite(sprite);
            sprite.destroy();
            clip.destroy();
            sources.value.delete(sourceKey);
        }

        const segmentIndex = rail.segments.findIndex(s => s.id === segment.id);
        rail.segments.splice(segmentIndex, 1);

        // if (rail.segments.length === 0) {
        //     const railIndex = rails.value.findIndex(r => r.id === rail.id);
        //     rails.value.splice(railIndex, 1);
        // }

        // 强制取消选中
        unselectSegment(segment.id, rail.id);
    }

    async function splitSegment({ segment, rail, keep }: { segment: WebCutSegment; rail: WebCutRail; keep?: 'left' | 'right' | 'both' }) {
        loading.value = true;
        try {
            const { sourceKey, start, end } = segment;
            const source = sources.value.get(sourceKey);
            if (!source) {
                return;
            }

            const { type, clip } = source;
            // 计算分割点（纳秒）
            const splitTime = cursorTime.value - start;

            // 将原始segment作为左侧部分
            const splitToKeepLeft = () => {
                segment.end = cursorTime.value;
                resetSegmentTime(segment);
            };

            // 将原始segment作为右侧部分
            const splitToKeepRight = () => {
                segment.start = cursorTime.value;
                resetSegmentTime(segment);
            };

            const onAfterGen = (key: string) => {
                if (clip.tickInterceptor) {
                    const newClip = sources.value.get(key)!.clip;
                    newClip.tickInterceptor = clip.tickInterceptor;
                }
            };

            // 通过切分，获得右侧部分时需要注意，
            // 新的clip需要复制原来的tickInterceptor

            // 如果只是保留左侧，直接更新segment时间即可
            if (keep === 'left') {
                splitToKeepLeft();
            }
            else if (type === 'video') {
                if (keep !== 'right') {
                    splitToKeepLeft();
                }
                const material = source.fileId ? `file:${source.fileId}` : source.url as string;
                const prevVideoMeta = source.meta.video || {};
                const key = await push('video', material, {
                    autoFitRect: 'contain',
                    time: {
                        start: cursorTime.value,
                        duration: end - cursorTime.value,
                    },
                    video: {
                        ...prevVideoMeta,
                        offset: splitTime + (prevVideoMeta.offset || 0),
                    },
                    withRailId: rail.id,
                });
                onAfterGen(key);
                if (keep === 'right') {
                    deleteSegment({ segment, rail });
                }
            }
            else if (type === 'audio') {
                if (keep !== 'right') {
                    splitToKeepLeft();
                }
                const material = source.fileId ? `file:${source.fileId}` : source.url as string;
                const prevAudioMeta = source.meta.audio || {};
                const key = await push('audio', material, {
                    time: {
                        start: cursorTime.value,
                        duration: end - cursorTime.value,
                    },
                    audio: {
                        ...prevAudioMeta,
                        offset: splitTime + (prevAudioMeta.offset || 0),
                    },
                    withRailId: rail.id,
                });
                onAfterGen(key);
                if (keep === 'right') {
                    deleteSegment({ segment, rail });
                }
            }
            // 如果是图片，则不需要进行实际的切分，只需要调整segment的时间，并创建一个新的segment
            else if (type === 'image') {
                if (keep === 'right') {
                    splitToKeepRight();
                }
                else {
                    splitToKeepLeft();
                    const { fileId, url } = source;
                    const src = fileId ? `file:${fileId}` : url as string;
                    const key = await push('image', src, {
                        time: {
                            start: cursorTime.value,
                            duration: end - cursorTime.value,
                        },
                        withRailId: rail.id,
                    });
                    onAfterGen(key);
                }
            }
            else if (type === 'text') {
                if (keep === 'right') {
                    splitToKeepRight();
                }
                else {
                    splitToKeepLeft();
                    const { text } = source;
                    const key = await push('text', text as string, {
                        time: {
                            start: cursorTime.value,
                            duration: end - cursorTime.value,
                        },
                        withRailId: rail.id,
                    });
                    onAfterGen(key);
                }
            }

            // 更新总时长
            updateDuration();
        } finally {
            loading.value = false;
        }
    }

    return {
        totalPx,
        cursorPx,
        cursorFrame,
        duration,
        totalFrameCount,
        cursorTime,
        fps,
        scale,
        moveCursorToTime,
        moveCursorToFrame,
        moveCursorToPx,
        timeToPx,
        pxToTime,
        pxOf1Frame,
        timeOf1Frame,
        scroll1,
        scroll2,
        ruler,
        resetSegmentTime,
        resizeManagerMaxHeight,
        toggleRailHidden,
        toggleRailMute,
        deleteSegment,
        splitSegment,
    };
}