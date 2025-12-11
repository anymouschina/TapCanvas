<script setup lang="ts">
import Handler, { DragEventData } from '../draggable-handler/index.vue';
import { NIcon } from 'naive-ui';
import { ChevronLeft, ChevronRight } from '@vicons/carbon';
import { ref, onUnmounted } from 'vue';

export type AdjustEventData = DragEventData & {
    left: number;
    top: number;
    width: number;
    height: number;
}

const emit = defineEmits(['leftMoveStart', 'leftMoveEnd', 'leftMoving', 'rightMoveStart', 'rightMoveEnd', 'rightMoving', 'leftClick', 'rightClick', 'moveStart', 'moveEnd', 'moving', 'select']);
const props = defineProps<{
    canMoveLeft?: (e: any) => boolean;
    canMoveRight?: (e: any) => boolean;
    canMove?: (e: any) => boolean;
    disabled?: boolean;
}>();

function canMoveMiddle(e: any) {
    if (props.disabled) {
        return false;
    }
    return props.canMove?.(e) ?? true;
}

const createBind = (name: any) => (e: DragEventData) => {
    const rect = shadowContainer.value?.getBoundingClientRect() || {};
    const { left, top, right, bottom, width, height, x, y } = rect;
    const data = { ...e, left, top, right, bottom, width, height, x, y };
    emit(name, data);
};

const handleLeftMoveStart = createBind('leftMoveStart');
const handleLeftMoveEnd = createBind('leftMoveEnd');
const handleLeftMoving = createBind('leftMoving');
const handleRightMoveStart = createBind('rightMoveStart');
const handleRightMoveEnd = createBind('rightMoveEnd');
const handleRightMoving = createBind('rightMoving');
const handleLeftClick = createBind('leftClick');
const handleRightClick = createBind('rightClick');
const handleMoveStart = createBind('moveStart');
const handleMoveEnd = createBind('moveEnd');
const handleMoving = createBind('moving');
const handleSelect = createBind('select');

const box = ref();
const shadowContainer = ref();

const startMouse = ref({ x: 0, y: 0 });

// 拖动状态变量
const isDragging = ref(false);
// 初始鼠标位置
const initialMouse = ref({ x: 0, y: 0 });
// 初始盒子位置
const initialBoxRect = ref({ x: 0, y: 0 });

// 在组件卸载时从document.body移除shadowContainer
onUnmounted(destroyDragShadow);

function destroyDragShadow() {
    if (shadowContainer.value && shadowContainer.value.parentNode === document.body) {
        document.body.removeChild(shadowContainer.value);
        shadowContainer.value = null;
    }
}

// 创建并挂载shadowContainer到document.body
function initDragShadow() {
    if (shadowContainer.value) {
        return;
    }

    // 创建shadowContainer元素
    const shadowElement = document.createElement('div');
    shadowElement.className = 'webcut-adjustable-box-clone-shadow';
    shadowElement.style.display = 'none';
    shadowElement.style.position = 'fixed';
    shadowElement.style.pointerEvents = 'none';
    shadowElement.style.zIndex = '1000';
    shadowElement.style.opacity = '0.7';

    // 创建内容容器
    const contentElement = document.createElement('div');
    contentElement.className = 'webcut-adjustable-box-clone-shadow-content';
    shadowElement.appendChild(contentElement);

    // 挂载到document.body
    document.body.appendChild(shadowElement);

    // 将创建的元素赋值给ref
    shadowContainer.value = shadowElement;
}

// 更新shadowContainer的尺寸和样式以匹配原box
function showDragShadow(e: DragEventData) {
    const shadowEl = shadowContainer.value;
    if (!shadowEl) {
        return;
    }

    if (isDragging.value) {
        return;
    }

    // 设置拖动状态
    isDragging.value = true;

    // 记录初始鼠标位置和盒子位置
    const rect = box.value.getBoundingClientRect();
    initialMouse.value = { x: e.pageX, y: e.pageY };
    initialBoxRect.value = { x: rect.left, y: rect.top };

    // 设置克隆阴影的初始位置和尺寸
    shadowEl.style.width = `${rect.width}px`;
    shadowEl.style.height = `${rect.height}px`;
    shadowEl.style.left = `${rect.left}px`;
    shadowEl.style.top = `${rect.top}px`;
    shadowEl.style.display = 'block';
    shadowEl.style.transform = `translate(0, 0)`;

    // 克隆webcut-adjustable-box-middle-handler的内容到shadowEl
    const shadowContent = shadowEl.querySelector('.webcut-adjustable-box-clone-shadow-content');
    const contentEl = box.value.querySelector('.webcut-adjustable-box-real-content');
    if (contentEl) {
        const parentEl = contentEl.parentElement;
        const fakeEl = contentEl.cloneNode(true) as HTMLElement;
        parentEl.insertBefore(fakeEl, contentEl);
        // 将原始DOM移到shadow中，这样可以维持原始DOM中的状态，如输入信息、canvas等
        shadowContent.appendChild(contentEl);
        // 将原middle-handler透明度设为0，视觉上“转移”到shadow
        fakeEl.style.opacity = '0';
    }
}

// 隐藏克隆阴影
function hideDragShadow() {
    const shadowEl = shadowContainer.value;
    if (!shadowEl) {
        return;
    }

    if (!isDragging.value) {
        return;
    }

    // 重置拖动状态
    isDragging.value = false;

    // 移除克隆的内容
    const fakeEl = box.value.querySelector('.webcut-adjustable-box-real-content');
    const contentEl = shadowEl.querySelector('.webcut-adjustable-box-real-content');
    if (contentEl && fakeEl) {
        const parentEl = fakeEl.parentElement;
        parentEl.insertBefore(contentEl, fakeEl);
        parentEl.removeChild(fakeEl);
        contentEl.style.opacity = '1';
    }

    // 重置克隆阴影位置
    shadowEl.style.display = 'none';
    shadowEl.style.transform = `translate(0, 0)`;
}

function updateDragShadow(e: DragEventData) {
    // 更新克隆阴影的位置
    if (isDragging.value && shadowContainer.value) {
        const shadowEl = shadowContainer.value;
        const rect = box.value.getBoundingClientRect();
        const { height } = rect;
        const deltaY = e.pageY - initialMouse.value.y;
        const deltaX = e.pageX - initialMouse.value.x;
        const offsetY = deltaY + (deltaY / Math.abs(deltaY)) * (height / 2);
        shadowEl.style.transform = `translate(${deltaX}px, ${offsetY}px)`;
    }
}

// 处理中间区域的拖动，区分横向和纵向
function handleMiddleMoveStart(e: any) {
    handleMoveStart(e);
    startMouse.value = { x: e.pageX, y: e.pageY };
}

function handleMiddleMoving(e: DragEventData) {
    handleMoving(e);

    const rect = box.value.getBoundingClientRect();
    if (e.pageY < rect.top || e.pageY > rect.bottom) {
        initDragShadow();
        showDragShadow(e);
    }
    else {
        hideDragShadow();
    }

    updateDragShadow(e);
}

function handleMiddleMoveEnd(e: DragEventData) {
    handleMoveEnd(e);
    hideDragShadow();

    // 当未发生位置偏移时，认为是点击事件
    const currentMouse = { x: e.pageX, y: e.pageY };
    const deltaX = currentMouse.x - startMouse.value.x;
    const deltaY = currentMouse.y - startMouse.value.y;
    if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) {
        handleSelect(e);
    }

    destroyDragShadow();
}
</script>

<template>
    <div class="webcut-adjustable-box" :class="{ 'webcut-adjustable-box--disabled': props.disabled, 'webcut-adjustable-box--dragging': isDragging }" ref="box">
        <Handler
            class="webcut-adjustable-box-handler webcut-adjustable-box-handler--left"
            @start="handleLeftMoveStart"
            @end="handleLeftMoveEnd"
            @move="handleLeftMoving"
            :can-move="props.canMoveLeft"
            v-if="!props.disabled"
        >
            <n-icon size="12px" class="webcut-adjustable-box-handler-icon" @mousedown.capture.stop @mouseup.capture.stop="handleLeftClick"><ChevronLeft /></n-icon>
        </Handler>
        <Handler
            class="webcut-adjustable-box-handler webcut-adjustable-box-handler--middle"
            @start="handleMiddleMoveStart"
            @end="handleMiddleMoveEnd"
            @move="handleMiddleMoving"
            :can-move="canMoveMiddle"
        >
            <div class="webcut-adjustable-box-real-content">
                <slot></slot>
            </div>
        </Handler>
        <Handler
            class="webcut-adjustable-box-handler webcut-adjustable-box-handler--right"
            @start="handleRightMoveStart"
            @end="handleRightMoveEnd"
            @move="handleRightMoving"
            :can-move="props.canMoveRight"
            v-if="!props.disabled"
        >
            <n-icon size="12px" class="webcut-adjustable-box-handler-icon" @mousedown.capture.stop @mouseup.capture.stop="handleRightClick"><ChevronRight /></n-icon>
        </Handler>
    </div>
</template>

<style scoped lang="less">
.webcut-adjustable-box {
    user-select: none;
    overflow: hidden;
    position: relative;
}
.webcut-adjustable-box-handler {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 8px;
    background-color: var(--text-color-3);
    cursor: col-resize;

    display: flex;
    align-items: center;
    justify-content: center;

    &--left {
        left: 0;
        z-index: 2;
    }

    &--right {
        right: 0px;
        z-index: 2;
    }

    &--middle {
        left: 0;
        right: 0;
        width: 100%;
        background-color: transparent;
        z-index: 1;
        cursor: default;
    }

    .webcut-adjustable-box--disabled & {
        cursor: default;
    }
}
.webcut-adjustable-box-real-content {
    width: 100%;
    height: 100%;
}
.webcut-adjustable-box-handler-icon {
    cursor: pointer;
}

/* 克隆阴影样式 */
:global(.webcut-adjustable-box-clone-shadow) {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(200, 200, 200, 0.8);
    border: 1px solid rgba(177, 177, 177, 0.8);
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    pointer-events: none;
    z-index: 1000;
    opacity: 0.6;
}

:global(.webcut-adjustable-box-clone-shadow-content) {
    width: 100%;
    height: 100%;
    border-radius: 8px;
    overflow: hidden;
}

.webcut-adjustable-box--dragging {
    .webcut-adjustable-box-handler--left,
    .webcut-adjustable-box-handler--right {
        display: none;
    }
}
</style>
