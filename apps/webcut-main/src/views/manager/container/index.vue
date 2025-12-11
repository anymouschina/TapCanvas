<script setup lang="ts">
import { onMounted, useSlots } from 'vue';
import ScrollBox from '../../../components/scroll-box/index.vue';
import { ref, watch, nextTick } from 'vue';
// @ts-ignore
import Draggable from "vue3-draggable";
import { useWebCutManager } from '../../../hooks/manager';
import Ticker from '../ticker/index.vue';
import Ruler from '../ruler/index.vue';
import Cursor from '../cursor/index.vue';
import AdjustableBox, { AdjustEventData } from '../../../components/adjustable-box/index.vue';
import { WebCutRail, WebCutSegment } from '../../../types';
import { Video } from '@vicons/carbon';
import { NIcon } from 'naive-ui';
import { useT } from '../../../hooks/i18n';
import { useWebCutContext } from '../../../hooks';
import { useWebCutHistory } from '../../../hooks/history';

export type WebCutManagerProps = {
    topBarColor?: string;
    railBgColor?: string;
    segmentBgColor?: string;
    segmentBorderColor?: string;
    segmentHandlerColor?: string;
    asideWidth?: number | string;
    /** 禁用空行，末尾不会有一段空的空间 */
    disableEmptyRail?: boolean;
    /** 轨道高度，默认60，注意，不包含gap，gap为4 */
    railHeight?: number;
    /** 轨道高度，根据类型不同而不同 */
    railHeightByType?: Record<string, number>;
    /** 禁用排序，默认false */
    disableSort?: boolean;
    /** 禁用尺寸调整 */
    disableResize?: boolean;
};

const emit = defineEmits(['sort', 'resize']);
/** 最大高度，默认240，注意，包含了topbar，topbar高度为20，还包含topbar和轨道之间的gap，gap为4 */
const maxHeight = defineModel<number>('maxHeight', { default: 264 });
const props = defineProps<WebCutManagerProps>();

const { rails, manager, selected, current, toggleSegment, unselectSegment, selectSegment } = useWebCutContext();
const slots = useSlots();
const { scroll1, scroll2, totalPx, timeToPx, pxToTime, pxOf1Frame, resetSegmentTime } = useWebCutManager();
const t = useT();
const { push: pushHistory } = useWebCutHistory();

const container = ref();

const showDragable = ref(true);
const dataList = ref<any[]>([]);
const moveState = ref<any>({});
const dragState = ref<any>({});
const highlightedRailId = ref<string | null>(null);

watch(() => rails.value?.length, (next, prev) => {
    if (next !== prev) {
        showDragable.value = false;
        dataList.value = [...(rails.value || [])].reverse();
        nextTick(() => {
            showDragable.value = true;
        });
    }
}, { immediate: true });

watch(() => dataList.value.length, updateManagerHeight);
onMounted(() => {
    updateManagerHeight();
});

function updateManagerHeight() {
    const topBarHeight = 20;
    const gap = 4;
    const defaultRailHeight = props.railHeight || 60;
    const totalRailsHeight = dataList.value.reduce((acc, cur) => {
        const { type } = cur;
        const height = props.railHeightByType?.[type] || defaultRailHeight;
        return acc + height + gap;
    }, 0);
    // 这里gap + 2是为了确保滚动条可以被用户触发，如果没有这个处理，用户无法拖动滚动条
    const areaHeight = totalRailsHeight === 0 ? gap + 2 : totalRailsHeight - gap;
    const railsHeight = areaHeight + (props.disableEmptyRail ? 0 : gap + defaultRailHeight);
    const railsMaxHeight = maxHeight.value - topBarHeight - gap;
    // 240为最大高度，大于240时，轨道高度会自适应
    const finalHeight = Math.min(railsHeight, railsMaxHeight) + topBarHeight + gap;
    if (scroll2.value && typeof scroll2.value.setHeight === 'function') {
        scroll2.value.setHeight(finalHeight);
    }
    if (scroll1.value && typeof scroll1.value.setHeight === 'function') {
        scroll1.value.setHeight(finalHeight);
    }
}

function resizeManagerMaxHeight(h: number) {
    maxHeight.value = h;
    updateManagerHeight();
}

function handleMoveStart(segment: WebCutSegment) {
    moveState.value = {
        segment,
        start: timeToPx(segment.start),
        width: timeToPx(segment.end - segment.start),
        end: timeToPx(segment.end),
    };
}

function handleMoveLeft(data: { offsetX: number }, segment: WebCutSegment) {
    if (moveState.value.segment !== segment) {
        return;
    }

    const { offsetX } = data;
    const start = timeToPx(segment.start);
    let newStart = start + offsetX;
    const end = moveState.value.end;

    // 边界限制：不能拖出轨道左侧
    newStart = Math.max(0, newStart);

    // 边界限制：不能超过右侧边界
    newStart = Math.min(newStart, end - 10); // 10px最小宽度

    moveState.value.start = newStart;
    moveState.value.width = end - newStart;
}

function handleMoveRight(data: { offsetX: number }, segment: WebCutSegment) {
    if (moveState.value.segment !== segment) {
        return;
    }

    const { offsetX } = data;
    const end = timeToPx(segment.end);
    let newEnd = end + offsetX;
    const start = moveState.value.start;

    // 边界限制：不能小于左侧边界
    newEnd = Math.max(newEnd, start + 10); // 10px最小宽度

    moveState.value.end = newEnd;
    moveState.value.width = newEnd - start;
}

function handleMoveRelease(segment: WebCutSegment, rail: WebCutRail) {
    if (moveState.value.segment !== segment) {
        return;
    }
    const { start, end } = moveState.value;
    segment.start = pxToTime(start);
    segment.end = pxToTime(end);
    moveState.value = {};
    resetSegmentTime(segment);
    pushHistory();
    emit('resize', { segment, rail });
}

function canMoveLeft(_e: any, segment: WebCutSegment, _rail: WebCutRail) {
    if (props.disableResize) {
        return false;
    }

    if (moveState.value.segment !== segment) {
        return false;
    }

    // 始终返回true，在handleMoving中处理边界限制
    return true;
}

function canMoveRight(_e: any, segment: WebCutSegment, _rail: WebCutRail) {
    if (props.disableResize) {
        return false;
    }

    if (moveState.value.segment !== segment) {
        return false;
    }

    // 始终返回true，在handleMoving中处理边界限制
    return true;
}

function handleLeftClick(segment: WebCutSegment, rail: WebCutRail) {
    if (props.disableResize) {
        return false;
    }
    handleMoveStart(segment);
    if (!canMoveLeft({ offsetX: -pxOf1Frame.value }, segment, rail)) {
        return;
    }
    moveState.value.start -= pxOf1Frame.value;
    handleMoveRelease(segment, rail);
}

function handleRightClick(segment: WebCutSegment, rail: WebCutRail) {
    if (props.disableResize) {
        return false;
    }
    handleMoveStart(segment);
    if (!canMoveRight({ offsetX: pxOf1Frame.value }, segment, rail)) {
        return;
    }
    moveState.value.end += pxOf1Frame.value;
    handleMoveRelease(segment, rail);
}

function handleDragStart(segment: WebCutSegment) {
    dragState.value = {
        segment,
        start: timeToPx(segment.start),
        end: timeToPx(segment.end),
        width: timeToPx(segment.end - segment.start),
    };
}

function handleDragging(data: AdjustEventData, segment: WebCutSegment, rail: WebCutRail) {
    if (dragState.value.segment !== segment) {
        return;
    }

    const { offsetX, pageY } = data;
    const start = timeToPx(segment.start);
    const segmentWidth = dragState.value.width;

    let newStart = start + offsetX;
    let newEnd = newStart + segmentWidth;

    // 边界限制：不能拖出轨道左侧
    newStart = Math.max(0, newStart);
    newEnd = newStart + segmentWidth;

    // 获取当前轨道中是否存在与新位置有重叠的segment，如果有，则不允许移动，保持当前位置，从而避免重叠
    const currentRail = rails.value.find(r => r.segments.includes(segment));
    if (currentRail) {
        const index = currentRail.segments.indexOf(segment);

        // 检查与左侧segment的重叠
        if (index > 0) {
            const prev = currentRail.segments[index - 1];
            const prevEnd = timeToPx(prev.end);
            if (newStart < prevEnd) {
                newStart = prevEnd;
                newEnd = newStart + segmentWidth;
            }
        }

        // 检查与右侧segment的重叠
        if (index < currentRail.segments.length - 1) {
            const next = currentRail.segments[index + 1];
            const nextStart = timeToPx(next.start);
            if (newEnd > nextStart) {
                newEnd = nextStart;
                newStart = newEnd - segmentWidth;
            }
        }
    }
    dragState.value.start = newStart;
    dragState.value.end = newEnd;

    // 悬停到新轨道时，高亮新轨道
    const railsContainer = container.value.querySelector('.webcute__manager__main__rails');
    if (railsContainer) {
        const railsElements = container.value.querySelectorAll('.webcute__manager__main__rail');
        let targetRailId: string | null = null;

        // 遍历所有轨道元素，判断鼠标位置
        railsElements.forEach((railEl: any, index: number) => {
            const rect = railEl.getBoundingClientRect();
            if (pageY >= rect.top && pageY <= rect.bottom) {
                // 找到对应的rail对象（注意reversedRails的顺序）
                const targetRail = dataList.value[index];
                if (targetRail.type === rail.type) {
                    targetRailId = targetRail.id;
                }
            }
        });

        // 更新高亮轨道
        if (targetRailId) {
            highlightedRailId.value = targetRailId;
        }
        else {
            highlightedRailId.value = null;
        }
    }
}

function handleDragEnd(data: AdjustEventData, segment: WebCutSegment, rail: WebCutRail) {
    if (dragState.value.segment !== segment) {
        return;
    }

    const { start, end } = dragState.value;
    let finalStart = start;
    let finalEnd = end;
    let targetRail = rail;


    const isSegmentSelected = selected.value.some(item => item.segmentId === segment.id);

    // 检查是否需要移动到新轨道
    const targetRailId = highlightedRailId.value;
    const newTargetRail = rails.value.find(r => r.id === targetRailId);
    // 只有相同类型的rail才允许移动
    if (targetRailId && newTargetRail && targetRailId !== rail.id && newTargetRail.type === rail.type) {
        // 获取假如需要放到新rail中时，该segment的位置，通过shadow盒子与轨道位置的对比，找到新位置起点
        const { width, left } = data;
        const boxLeft = container.value.querySelector('.webcute__manager__main__rails')?.getBoundingClientRect().left || 0;
        const newStart = left - boxLeft;
        const newEnd = newStart + width;
        // 检查与新轨道中其他segment的重叠
        const targetSegments = [...newTargetRail.segments.filter(s => s !== segment)].sort((a, b) => a.start - b.start);
        // 检查是否存在重叠
        const newStartTime = pxToTime(newStart);
        const newEndTime = pxToTime(newEnd);
        const overlap = targetSegments.some(seg => !(newStartTime >= seg.end || newEndTime <= seg.start));
        // 只有当新轨道中的segment没有与当前segment存在重叠时，才可以移到新轨道
        if (!overlap && newTargetRail) {
            // 先取消选中，避免在移动之后其rail与真实的rail对应不上
            if (isSegmentSelected) {
                unselectSegment(segment.id, rail.id);
            }

            // 从原轨道移除segment
            const segmentIndex = rail.segments.indexOf(segment);
            if (segmentIndex > -1) {
                rail.segments.splice(segmentIndex, 1);
            }

            // 添加segment到目标轨道
            newTargetRail.segments.push(segment);
            targetRail = newTargetRail;
            // 重新选中该segment
            if (isSegmentSelected) {
                selectSegment(segment.id, targetRail.id);
            }

            // // 如果原轨道没有segment了，就从rails中移除该轨道
            // if (rail.segments.length === 0) {
            //     const railIndex = rails.value.findIndex(r => r.id === rail.id);
            //     rails.value.splice(railIndex, 1);
            // }

            finalStart = newStart;
            finalEnd = newEnd;
        }
    }
    // 更新segment时间信息
    segment.start = pxToTime(finalStart);
    segment.end = pxToTime(finalEnd);

    // 重置状态
    dragState.value = {};
    highlightedRailId.value = null;

    resetSegmentTime(segment);
    pushHistory();
    emit('resize', { segment, rail: targetRail });
}

function canMoveSegment(_e: any, segment: WebCutSegment, _rail: WebCutRail) {
    if (props.disableResize) {
        return false;
    }

    if (dragState.value.segment !== segment) {
        return false;
    }

    // 始终返回true，在handleMoving中处理边界限制
    return true;
}

function handleClickSegment(item: WebCutSegment, rail: WebCutRail) {
    toggleSegment(item.id, rail.id);
}

const exposes = {
    resizeManagerMaxHeight,
};
manager.value = exposes;
</script>

<template>
    <div class="webcut__manager" :style="{
        '--webcut-manager-top-bar-color': props.topBarColor,
        '--webcut-manager-rail-bg-color': props.railBgColor || 'var(--webcut-rail-bg-color)',
        '--webcut-manager-segment-bg-color': props.segmentBgColor || 'var(--webcut-grey-color)',
        '--webcut-manager-segment-border-color': props.segmentBorderColor || 'var(--border-color)',
        '--webcut-manager-segment-handler-color': props.segmentHandlerColor || 'var(--webcut-grey-deep-color)',
        '--webcut-manager-aside-width': props.asideWidth && typeof props.asideWidth === 'number' ? props.asideWidth + 'px' : props.asideWidth,
    }" ref="container">
        <div class="webcut__manager__aside" v-if="slots['asideRail']">
            <scroll-box class="webcut__mananger__aside__scroll-box" ref="scroll1" y-placement="left">
                <div class="webcut__mananger__top-bar"></div>
                <Draggable v-model="dataList" class="webcut__mananger__aside__list" @update:model-value="emit('sort', dataList)" v-if="showDragable && !props.disableSort">
                    <template #item="{ item }">
                        <div class="webcute__manager__aside__rail" :style="{ '--rail-height': props.railHeightByType?.[item.type] ? props.railHeightByType?.[item.type] + 'px' : undefined }">
                            <slot name="asideRail" :rail="item" :railIndex="dataList.indexOf(item)"></slot>
                        </div>
                    </template>
                </Draggable>
                <div class="webcut__mananger__aside__list" v-if="props.disableSort">
                    <div class="webcute__manager__aside__rail" undraggable v-for="item in dataList" :style="{ '--rail-height': props.railHeightByType?.[item.type] ? props.railHeightByType?.[item.type] + 'px' : undefined }">
                        <slot name="asideRail" :rail="item" :railIndex="dataList.indexOf(item)"></slot>
                    </div>
                </div>
                <div class="webcute__manager__aside__rail webcute__manager__aside__rail--empty" v-if="!props.disableEmptyRail && rails.length === 0"></div>
                <slot name="asideFooter"></slot>
                <div class="webcut__mananger__footer-placeholder"></div>
            </scroll-box>
        </div>
        <div class="webcut__manager__main">
            <scroll-box class="webcut__manager__main__scroll-box" x-scrollable ref="scroll2" :content-width="totalPx + 10">
                <div class="webcut__mananger__top-bar"></div>
                <div class="webcute__manager__main__rails">
                    <div
                        v-for="(rail,railIndex) in dataList" :key="rail.id"
                        class="webcute__manager__main__rail"
                        :class="{
                            'webcute__manager__main__rail--highlighted': highlightedRailId === rail.id,
                            'webcute__manager__main__rail--locked': rail.locked,
                            'webcute__manager__main__rail--hidden': rail.hidden,
                        }"
                        :style="{ '--rail-height': props.railHeightByType?.[rail.type || ''] ? props.railHeightByType?.[rail.type || ''] + 'px' : undefined }"
                    >
                        <AdjustableBox
                            v-for="(item,segmentIndex) in rail.segments"
                            :key="item.id"
                            class="webcute__manager__main__rail-segment"
                            :class="{
                                'webcute__manager__main__rail-segment--selected': selected.some(i => i.segmentId === item.id && i.railId === rail.id),
                                'webcute__manager__main__rail-segment--current': current === item.id,
                            }"
                            :style="{
                                '--segment-left': moveState.segment === item ? moveState.start + 'px' : (dragState.segment === item ? dragState.start + 'px' : timeToPx(item.start) + 'px'),
                                '--segment-width': moveState.segment === item ? moveState.width + 'px' : (dragState.segment === item ? dragState.width + 'px' : timeToPx(item.end - item.start) + 'px')
                            }"
                            @left-move-start="handleMoveStart(item)"
                            @left-moving="handleMoveLeft($event, item)"
                            @left-move-end="handleMoveRelease(item, rail)"
                            @right-move-start="handleMoveStart(item)"
                            @right-moving="handleMoveRight($event, item)"
                            @right-move-end="handleMoveRelease(item, rail)"
                            @left-click="handleLeftClick(item, rail)"
                            @right-click="handleRightClick(item, rail)"
                            @move-start="handleDragStart(item)"
                            @moving="handleDragging($event, item, rail)"
                            @move-end="handleDragEnd($event, item, rail)"
                            @select="handleClickSegment(item, rail)"
                            :can-move-left="e => canMoveLeft(e, item, rail)"
                            :can-move-right="e => canMoveRight(e, item, rail)"
                            :can-move="e => canMoveSegment(e, item, rail)"
                            :disabled="props.disableResize"
                        >
                            <slot name="mainSegment" :segment="item" :rail="rail" :segmentIndex="segmentIndex" :railIndex="railIndex" :segments="rail.segments"></slot>
                        </AdjustableBox>
                        <slot name="mainRailEnd" :rail="rail" :railIndex="railIndex"></slot>
                    </div>
                    <div class="webcute__manager__main__rail webcute__manager__main__rail--empty" v-if="!props.disableEmptyRail && rails.length === 0">
                        <div class="webcute__manager__main__rail--empty__text">
                            <n-icon :component="Video" size="large"></n-icon>
                            <small>{{ t('选择一个视频，开始你的创作。') }}</small>
                        </div>
                    </div>
                    <slot name="mainRailsFooter"></slot>
                </div>
                <div class="webcut__mananger__footer-placeholder" v-if="rails.length > 0"></div>
                <Ruler class="webcut__manager__main__ruler" />
                <Ticker class="webcut__manager__main__ticker" />
                <Cursor class="webcut__manager__main__curosr" />
            </scroll-box>
        </div>
    </div>
</template>

<style scoped lang="less">
@height: 60px;
@gap: 4px;

.webcut__manager {
    width: 100%;
    display: flex;
    justify-content: center;

    .webcut-control-button + & {
        margin-top: 16px;
    }

    --webcut-manager-rail-height: @height;
    --webcut-manager-gap: @gap;
}
.webcut__mananger__top-bar {
    height: 20px;
    margin-bottom: @gap;
    background-color: var(--webcut-manager-top-bar-color);
    position: sticky;
    top: 0;
    z-index: 100;
}
.webcut__manager__aside {
    width: var(--webcut-manager-aside-width);
    position: relative;
    border-right: 1px solid var(--webcut-line-color);
    overflow: auto;
}
.webcut__manager__main {
    flex: 1;
    overflow: auto;
    position: relative;
    // 下面为timeline fixed准备
    transform: translate(0, 0);
    overflow: hidden;
}
.webcut__manager__main__scroll-box {
    height: 100%;
}
.webcute__manager__main__rails {
    display: flex;
    flex-direction: column;
    gap: @gap;
}
.webcut__mananger__footer-placeholder {
    height: 12px;
}
.webcute__manager__main__rail {
    position: relative;
    padding-left: 10px;
    height: var(--rail-height, @height);
    background-color: var(--webcut-manager-rail-bg-color);
    border-bottom-right-radius: 8px;
    border-top-right-radius: 8px;
    transition: all 0.2s ease;
}
.webcute__manager__main__rail--highlighted {
    background-color: var(--webcut-rail-hover-bg-color);
}
.webcute__manager__main__rail--locked::after {
    content: '';
    display: block;
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 1000;
    background-image: linear-gradient(
        45deg,
        var(--modal-color) 0, var(--modal-color) 25%, transparent 25%, transparent 50%,
        var(--modal-color) 50%, var(--modal-color) 75%, transparent 75%, transparent
    );
    background-size: 6px 6px;
    border-radius: 4px;
}
.webcute__manager__main__rail--hidden {
    opacity: .3;
    pointer-events: none;
}
.webcute__manager__main__rail--empty__text {
    height: 100%;
    display: flex;
    align-items: center;
    gap: 4px;
    justify-content: flex-start;
    opacity: .4;
    padding-left: 18px;
}

.webcute__manager__main__rail-segment {
    position: absolute;
    left: calc(var(--segment-left) + 10px);
    width: var(--segment-width);
    box-sizing: border-box;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: @gap;
    border: 1px solid var(--webcut-manager-segment-border-color);
    background-color: var(--webcut-manager-segment-bg-color);
    border-radius: 8px;
    padding: 0 12px;

    :deep(.webcut-adjustable-box-handler) {
        background-color: var(--webcut-manager-segment-handler-color);
    }
}
.webcute__manager__main__rail-segment--selected {
    border-color: var(--primary-color);
}
.webcute__manager__main__rail-segment--current::after {
    content: '';
    display: block;
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    border-radius: 6px;
    z-index: 10;
    border: 3px solid var(--primary-color);
    pointer-events: none;
}
.webcut__mananger__aside__list {
    display: flex;
    flex-direction: column;
    gap: @gap;
}
.webcute__manager__aside__rail {
    height: var(--rail-height, @height);
    background-color: var(--webcut-manager-rail-bg-color);
    border-top-left-radius: 8px;
    border-bottom-left-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    padding: 0 1em;
    margin-left: 4px;
}
</style>