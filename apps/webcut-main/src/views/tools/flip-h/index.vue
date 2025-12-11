<script setup lang="ts">
import { NIcon, NPopover, NButton } from 'naive-ui';
import { FlipHorizontal16Regular } from '@vicons/fluent';
import { useWebCutContext } from '../../../hooks';
import { useWebCutHistory } from '../../../hooks/history';
import { useT } from '../../../hooks/i18n';
import { computed } from 'vue';

const { currentSource } = useWebCutContext();
const { push: pushHistory } = useWebCutHistory();
const t = useT();

// 检查当前选中的素材是否可以进行水平翻转
const canFlip = computed(() => {
  if (!currentSource.value) {
    return false;
  }

  // 只对视频、图片、文本素材生效
  return ['video', 'image', 'text'].includes(currentSource.value.type);
});

// 处理水平翻转
async function handleFlip() {
  if (!currentSource.value) {
    return;
  }

  const { sprite } = currentSource.value;

  // 设置sprite的flip属性为horizontal
  const next = sprite.flip = sprite.flip === 'horizontal' ? null : 'horizontal';

  // 在source.meta中新增flip为horizontal
  if (!currentSource.value.meta) {
    currentSource.value.meta = {};
  }
  currentSource.value.meta.flip = next as any;

  await pushHistory();
}
</script>

<template>
  <n-popover :delay="200" class="webcut-tooltip">
    <template #trigger>
      <n-button quaternary size="small" :focusable="false" @click="handleFlip" class="webcut-tool-button" :disabled="!canFlip">
        <template #icon>
          <n-icon :component="FlipHorizontal16Regular" size="16px"></n-icon>
        </template>
      </n-button>
    </template>
    <small>{{ t('水平翻转') }}</small>
  </n-popover>
</template>
