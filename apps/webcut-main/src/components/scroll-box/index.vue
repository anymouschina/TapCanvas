<script setup lang="ts">
import { ref, onMounted, onUpdated, nextTick, onBeforeUnmount, computed, provide } from 'vue';
import { NScrollbar, ScrollbarInst } from 'naive-ui';
import { Evt } from '../../libs/evt';

const props = defineProps<{
    /** 是否修复高度 */
    fixHeight?: boolean;
    /** 是否将原来的flex:1替换为flex:auto */
    fixFlex?: boolean;
    /** 是否横向滚动 */
    xScrollable?: boolean;
    /** 纵向滚动条位置 */
    yPlacement?: 'left' | 'right';
    /** 内容宽度 */
    contentWidth?: number | string;
    /** 内容高度 */
    contentHeight?: number | string;
}>();
const emit = defineEmits(['scroll']);

const scroller = ref<ScrollbarInst>();
const boxview = ref<HTMLElement>();
const scrollOffset = ref<any>({ top: 0, left: 0 });
const scrollBoxHeight = ref();
const scrollBoxWidth = ref();

const evt = new Evt();

// 滚动到底部
function scrollToBottom(smooth?: boolean) {
    if (!scroller.value) {
        return;
    }
    nextTick(() => setTimeout(() => {
        // @ts-ignore
        const container = scroller.value?.scrollbarInstRef?.containerRef;
        const currentOffset = getScrollOffset();
        scroller.value?.scrollTo({ top: container.scrollHeight, left: currentOffset.left, behavior: smooth ? 'smooth' : 'auto' });
    }, 16));
}

// 滚动到顶部
function scrollToTop(smooth?: boolean) {
    if (!scroller.value) {
        return;
    }
    setTimeout(() => {
        const currentOffset = getScrollOffset();
        scroller.value?.scrollTo({ top: 0, left: currentOffset.left, behavior: smooth ? 'smooth' : 'auto' });
    }, 16);
}

function scrollTo(position: { left?: number, top?: number }, smooth?: boolean, immediate?: boolean) {
    return new Promise((resolve) => {
        if (!scroller.value) {
            resolve(null);
            return;
        }
        const scroll = () => {
            const currentOffset = getScrollOffset();
            const { left = currentOffset.left, top = currentOffset.top } = position;
            scroller.value?.scrollTo({ top, left, behavior: smooth ? 'smooth' : 'auto' });
            setTimeout(resolve, 16);
        };
        if (immediate) {
            scroll();
        }
        else {
            setTimeout(scroll, 16);
        }
    });
}

function scrollBy(distance: { left?: number, top?: number }, smooth?: boolean, immediate?: boolean) {
    if (!scroller.value) {
        return;
    }

    const scroll = () => {
        const currentOffset = getScrollOffset();
        const { left = currentOffset.left, top = currentOffset.top } = distance;
        scroller.value?.scrollBy({ top, left, behavior: smooth ? 'smooth' : 'auto' });
    };

    if (immediate) {
        scroll();
    } else {
        setTimeout(scroll, 16);
    }
}

let timer: any;
let originHeight: string | number;
const adjust = () => {
    if (!boxview.value) {
        return;
    }

    const box = boxview.value;
    clearTimeout(timer);
    // 通过比较hack的形式，确保滚动区域一定有高度，这样就可以在外部没有设置高度的情况下，实现滚动条的出现
    timer = setTimeout(() => {
        const style = box.style;

        // 记录原始高度
        if (typeof originHeight === 'undefined') {
            originHeight = style.height;
        }

        // 先恢复弹性高度，使它能够自动撑开
        if (props.fixHeight) {
            style.height = 'auto';
        }
        // 自动高度之后，再来计算真实高度
        setTimeout(() => {
            const computedStyle = window.getComputedStyle(box, null);

            const { flexBasis, height: selfHeight } = computedStyle;

            if (props.fixHeight) {
                style.height = selfHeight;
            }

            // 修复flex的问题
            if (flexBasis !== 'auto' && props.fixFlex) {
                style.flexBasis = 'auto';
            }
        }, 32);
    }, 16);
};

function handleScroll() {
    const offset = getScrollOffset();
    scrollOffset.value = offset;
    emit('scroll', offset);
    evt.emit('scroll', offset);
}

onMounted(adjust);
onUpdated(adjust);

function onScroll(fn: (offset: { top: number, left: number }) => void) {
    evt.on('scroll', fn);
}

onBeforeUnmount(() => {
    evt.off('scroll');
});

function getScrollOffset() {
    // @ts-ignore
    const { yBarTopPx, yBarSizePx, xBarLeftPx, xBarSizePx } = scroller.value?.scrollbarInstRef;

    const container = boxview.value?.querySelector('.n-scrollbar-container');
    const content = boxview.value?.querySelector('.n-scrollbar-content');

    const contentRect = content?.getBoundingClientRect();
    const containerRect = container?.getBoundingClientRect();

    const { left: contentLeft = 0, top: contentTop = 0 } = contentRect || {};
    const { left: containerLeft = 0, top: containerTop = 0 } = containerRect || {};

    const left = containerLeft - contentLeft;
    const top = containerTop - contentTop;

    const offset = {
        yBarTopPx, yBarSizePx, xBarLeftPx, xBarSizePx,
        left,
        top,
    };

    return offset;
}

function getScrollContainerSize() {
    const { width, height } = boxview.value?.getBoundingClientRect() || {};
    return { width, height };
}

function getScrollContentSize() {
    // @ts-ignore
    const contentRef = scroller.value?.scrollbarInstRef?.contentRef;
    const { width, height } = contentRef?.getBoundingClientRect() || {};
    return { width, height };
}

function setHeight(height: number) {
    if (!boxview.value) {
        return;
    }
    boxview.value.style.height = height + 'px';
}

let animate: any;
function syncScrollBoxHeight() {
    const size = getScrollContainerSize();
    const nextHeight = size?.height;
    if (nextHeight !== scrollBoxHeight.value) {
        scrollBoxHeight.value = nextHeight;
    }
    const nextWidth = size?.width;
    if (nextWidth !== scrollBoxWidth.value) {
        scrollBoxWidth.value = nextWidth;
    }
    animate = requestAnimationFrame(syncScrollBoxHeight);
}
onMounted(syncScrollBoxHeight);
onBeforeUnmount(() => cancelAnimationFrame(animate));

const exports = {
    scrollToBottom,
    scrollToTop,
    scrollTo,
    scrollBy,
    getScrollOffset,
    getScrollContainerSize,
    getScrollContentSize,
    onScroll,
    boxview,
    scroller,
    setHeight,
};
defineExpose(exports);

provide('scroller', exports);

const contentStyle = computed(() => {
    return {
        width: typeof props.contentWidth === 'number' ? props.contentWidth + 'px' : props.contentWidth || 'fit-content',
        height: typeof props.contentHeight === 'number' ? props.contentHeight + 'px' : props.contentHeight || 'fit-content',
    };
});
</script>

<template>
    <div
        class="webcut-scroll-box"
        ref="boxview"
        :style="{
            '--scroll-left': scrollOffset.left + 'px',
            '--scroll-top': scrollOffset.top + 'px',
            '--scroll-box-height': scrollBoxHeight + 'px',
            '--scroll-box-width': scrollBoxWidth + 'px',
        }"
    >
        <n-scrollbar
            ref="scroller"
            :x-scrollable="props.xScrollable"
            :y-placement="props.yPlacement"
            :content-style="contentStyle"
            @scroll="handleScroll"
        >
            <slot></slot>
        </n-scrollbar>
    </div>
</template>

<style scoped>
.webcut-scroll-box {
    flex: 1;
    height: 100%;
    overflow: auto;
}
</style>
