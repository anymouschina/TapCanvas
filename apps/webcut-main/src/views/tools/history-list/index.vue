<script setup lang="ts">
import { NPopover, NButton, NIcon, NSelect } from 'naive-ui';
import { List } from '@vicons/carbon';
import { useWebCutHistory } from '../../../hooks/history';
import { useT } from '../../../hooks/i18n';
import { computed } from 'vue';

const t = useT();
const { historyList, currentHistoryId, jumpTo } = useWebCutHistory();

const options = computed(() => {
  return historyList.value.map((item, index) => {
    const label = `${index + 1}. ${new Date(item.timestamp).toLocaleTimeString()}`;
    return { label, value: item.id };
  });
});

async function handleSelect(value: string) {
  if (!value || value === currentHistoryId.value) {
    return;
  }
  await jumpTo(value);
}
</script>

<template>
  <n-popover trigger="click" class="webcut-tooltip">
    <template #trigger>
      <n-button quaternary size="small" :focusable="false" class="webcut-tool-button" :disabled="historyList.length === 0">
        <template #icon>
          <n-icon :component="List" size="16px"></n-icon>
        </template>
      </n-button>
    </template>
    <div style="min-width: 200px; padding: 4px;">
      <div style="margin-bottom: 6px; font-size: 12px; opacity: .7;">{{ t('历史记录') }}</div>
      <n-select
        size="small"
        :options="options"
        :value="currentHistoryId"
        @update:value="handleSelect"
        :placeholder="t('选择历史记录')"
      />
    </div>
  </n-popover>
</template>

