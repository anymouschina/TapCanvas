<script setup lang="ts">
import { NPopover, NButton, NIcon } from 'naive-ui';
import { History16Regular } from '@vicons/fluent';
import { useT } from '../../../hooks/i18n';
import { useWebCutHistory } from '../../../hooks/history';
import { ref } from 'vue';

const t = useT();
const { canRecover, recover } = useWebCutHistory();
const showTooltip = ref(true);
</script>

<template>
  <n-popover :delay="200" class="webcut-tooltip" :show="canRecover && showTooltip" @clickoutside="showTooltip = false">
    <template #trigger>
      <n-button :type="canRecover ? 'primary' : 'default'" quaternary size="small" :focusable="false" @click="recover" class="webcut-tool-button" :disabled="!canRecover">
        <template #icon>
          <n-icon :component="History16Regular" size="16px"></n-icon>
        </template>
      </n-button>
    </template>
    <small>{{ t('恢复正在编辑的数据') }}</small>
  </n-popover>
</template>
