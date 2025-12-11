<script setup lang="ts">
import { NIcon, NSlider, NButton } from 'naive-ui';
import { ZoomIn, ZoomOut } from '@vicons/carbon';
import { useWebCutManager } from '../../../hooks/manager';

const { scale } = useWebCutManager();

function handleChange(diff: number) {
  const curr = scale.value;
  const next = curr + diff;
  const final = next > 100 ? 100 : next < 0 ? 0 : next;
  scale.value = final;
}
</script>

<template>
  <div class="webcut-timeline-scale-control">
    <n-button text @click="handleChange(-10)" size="small">
      <n-icon><ZoomOut /></n-icon>
    </n-button>
    <n-slider v-model:value="scale" :max="100" :min="0" :step="10" :tooltip="false">
      <template #thumb>
        <div class="webcut-timeline-scale-thumb"></div>
      </template>
    </n-slider>
    <n-button text @click="handleChange(10)" size="small">
      <n-icon><ZoomIn /></n-icon>
    </n-button>
  </div>
</template>

<style scoped lang="less">
.webcut-timeline-scale-control {
  width: 160px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.webcut-timeline-scale-thumb {
  width: 10px;
  height: 10px;
  background-color: var(--webcut-thumb-color);
  border: 1px solid var(--border-color);
  border-radius: 50%;
}
.webcut-timeline-scale-control :deep(.n-slider .n-slider-handles) {
  left: 0;
  right: 0;
}

@media screen and (max-width: 960px) {
    .webcut-timeline-scale-control {
        width: 100px;
    }
}
</style>