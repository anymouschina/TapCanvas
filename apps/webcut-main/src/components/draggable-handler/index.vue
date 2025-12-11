<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';

/**
 * 事件抛出的信息如下：
 * startX: 一开始移动的pageX位置
 * startY: 一开始移动的pageY位置
 * pageX: 当前移动的位置
 * pageY: 当前移动的位置
 * offsetX: 相对于一开始移动的距离
 * offsetY: 相对于一开始移动的距离
 * moveX: 相对于上一次抛出事件移动的多少
 * moveY: 相对于上一次抛出事件移动的多少
 * 其中，offsetX/Y, moveX/Y 受到canMove的影响，在canMove返回false时可能不会发生变化，
 * startX/Y 整个过程不会变化
 * pageX/Y 是当前鼠标位置，一直会变化
 * start事件发生时，还没有移动，因此没有offsetX/Y, moveX/Y
 */
export type DragEventData = {
  startX: number;
  startY: number;
  pageX: number;
  pageY: number;
  offsetX: number;
  offsetY: number;
  moveX: number;
  moveY: number;
};

const emit = defineEmits(['start', 'move', 'end']);
const props = defineProps<{
  canMove?: (e: any) => boolean;
}>();

const isDragging = ref(false);

let startX = 0;
let startY = 0;
let latestX = 0;
let latestY = 0;

function onMouseDown(event: MouseEvent) {
  if (event.button !== 0) {
    return;
  }

  event.stopPropagation();
  event.preventDefault();
  isDragging.value = true;

  const pageX = event.pageX;
  startX = pageX;
  latestX = pageX;

  const pageY = event.pageY;
  startY = pageY;
  latestY = pageY;

  emit('start', { startX, pageX, startY, pageY });
}

function onMouseMove(event: MouseEvent) {
  if (isDragging.value) {
    const pageX = event.pageX;
    const pageY = event.pageY;
    // 相对于一开始移动的距离
    const offsetX = pageX - startX;
    const offsetY = pageY - startY;
    // 相对于上一次移动的多少
    const moveX = pageX - latestX;
    const moveY = pageY - latestY;

    const moveData = {
      offsetX, offsetY, moveX, moveY,
      startX, pageX, startY, pageY,
    };

    // 即使canMove返回false，也继续保持拖拽状态，只在有效范围内更新位置
    if (!props.canMove || props.canMove(moveData)) {
      latestX = pageX;
      latestY = pageY;
    }

    emit('move', moveData);
  }
}

function onMouseUp(event: MouseEvent) {
  if (isDragging.value) {

    const pageX = event.pageX;
    const pageY = event.pageY;

    const moveX = pageX - latestX;
    const moveY = pageY - latestY;

    // 注意，结束时不用pageX - startX，因为在移动过程中，可能被 canMove 禁止移动
    const offsetX = latestX - startX;
    const offsetY = latestY - startY;

    emit('end', {
      offsetX, offsetY, moveX, moveY,
      startX, pageX, startY, pageY,
    });
  }

  startX = 0;
  latestX = 0;
  startY = 0;
  latestY = 0;

  isDragging.value = false;
}

onMounted(() => {
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
});

onBeforeUnmount(() => {
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mouseup', onMouseUp);
});
</script>

<template>
    <div class="webcut-adjustable-box-handler" @mousedown="onMouseDown"><slot></slot></div>
</template>
