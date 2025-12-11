<script setup lang="ts">
import { computed } from 'vue';
import { useWebCutManager } from '../../../hooks/manager';

const emit = defineEmits(['moveEnd']);

const { cursorPx } = useWebCutManager();

const trackStyle = computed(() => {
  return {
    '--webcut-ticker-left': `${cursorPx.value}px`,
  };
});
</script>

<template>
  <div class="webcut__manager__ticker">
    <div class="webcut__manager__ticker__line" :style="trackStyle"></div>
  </div>
</template>

<style scoped lang="less">
.webcut__manager__ticker {
  position: sticky;
  left: 0;
  top: 0;
  z-index: 1000;
}
.webcut__manager__ticker__line {
  position: fixed;
  top: 0;
  left: calc(var(--webcut-ticker-left) + 10px - var(--scroll-left));
  border-right: 1px solid var(--text-color-base);
  height: var(--scroll-box-height, 100%);
  transform: translateX(50%);
}
</style>