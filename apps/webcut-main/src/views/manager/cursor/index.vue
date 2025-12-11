<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from 'vue';
import { useWebCutPlayer } from '../../../hooks/index';
import { useWebCutManager } from '../../../hooks/manager';

const emit = defineEmits(['moveEnd']);

const { cursorPx, moveCursorToPx, scroll2 } = useWebCutManager();
const { pause } = useWebCutPlayer();

const cursorRef = ref<HTMLElement>();

const trackStyle = computed(() => {
  return {
    '--webcut-cursor-left': `${cursorPx.value}px`,
  };
});

const isDragging = ref(false);

function onMouseDown(event: MouseEvent) {
  event.stopPropagation();
  event.preventDefault();
  pause();
  isDragging.value = true;
}

function onMouseMove(event: MouseEvent) {
    // event.stopPropagation();
    // event.preventDefault();
    if (isDragging.value) {
      const rect = scroll2.value!.boxview.getBoundingClientRect();
      const scrollLeft = scroll2.value.getScrollOffset().left;
      const offsetX = Math.max(0, event.pageX - rect.left + scrollLeft - 10);
      moveCursorToPx(offsetX);
    }
}

function onMouseUp() {
    // event.stopPropagation();
    // event.preventDefault();

    if (isDragging.value) {
        emit('moveEnd');
    }
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

defineExpose({
  cursor: cursorRef,
});
</script>

<template>
  <div class="webcut__manager__cursor">
    <div class="webcut__manager__cursor__handler" ref="cursorRef" :style="trackStyle" @mousedown="onMouseDown"></div>
  </div>
</template>

<style scoped lang="less">
.webcut__manager__cursor {
  position: sticky;
  left: 0;
  top: 0;
  z-index: 9001;
}
.webcut__manager__cursor__handler {
  position: fixed;
  left: calc(var(--webcut-cursor-left) + 10px - var(--scroll-left));
  top: 0;
  width: 10px;
  height: 10px;
  background-color: var(--text-color-base);
  transform: translateX(-50%);
  margin-left: 1px;
  cursor: col-resize;
  pointer-events: initial;

  &::after {
    content: '';
    display: block;
    width: 0;
    height: 0;
    border: 5px solid var(--text-color-base);
    position: absolute;
    top: 100%;
    border-right-color: transparent;
    border-left-color: transparent;
    border-bottom-color: transparent;
  }
}
</style>