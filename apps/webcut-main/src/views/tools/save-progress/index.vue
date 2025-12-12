<script setup lang="ts">
import { NPopover, NButton, NIcon } from 'naive-ui';
import { Save } from '@vicons/carbon';
import { useWebCutHistory } from '../../../hooks/history';
import { useT } from '../../../hooks/i18n';
import { useMessage } from 'naive-ui';

const t = useT();
const toast = useMessage();
const { saveProgress } = useWebCutHistory();

async function handleSave() {
  try {
    await saveProgress();
    toast.success(t('已保存当前进度'));
  } catch (e: any) {
    toast.error(e?.message || t('保存失败'));
  }
}
</script>

<template>
  <n-popover :delay="200" class="webcut-tooltip">
    <template #trigger>
      <n-button quaternary size="small" :focusable="false" @click="handleSave" class="webcut-tool-button">
        <template #icon>
          <n-icon :component="Save" size="16px"></n-icon>
        </template>
      </n-button>
    </template>
    <small>{{ t('保存进度') }}</small>
  </n-popover>
</template>

