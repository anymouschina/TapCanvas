<script setup lang="ts">
import { computed } from 'vue';
import { NDropdown, NButton, NIcon } from 'naive-ui';
import { Translate } from '@vicons/carbon';
import { useWebCutLocale } from '../../hooks/i18n';

const { locale } = useWebCutLocale();

// 语言选项
const languageOptions = computed(() => [
  {
    label: '中文（简体）',
    key: 'zh-CN',
    disabled: locale.value === 'zh-CN' || locale.value === 'zh',
  },
  {
    label: 'English',
    key: 'en-US',
    disabled: locale.value === 'en-US' || locale.value === 'en',
  },
  {
    label: 'Français',
    key: 'fr-FR',
    disabled: locale.value === 'fr-FR' || locale.value === 'fr',
  },
  {
    label: '日本語',
    key: 'ja-JP',
    disabled: locale.value === 'ja-JP' || locale.value === 'ja',
  },
  {
    label: 'Deutsch',
    key: 'de-DE',
    disabled: locale.value === 'de-DE' || locale.value === 'de',
  },
  {
    label: 'Español',
    key: 'es-ES',
    disabled: locale.value === 'es-ES' || locale.value === 'es',
  },
  {
    label: '中文（香港）',
    key: 'zh-HK',
    disabled: locale.value === 'zh-HK',
  },
  {
    label: '中文（台灣）',
    key: 'zh-TW',
    disabled: locale.value === 'zh-TW',
  },
]);

// 当前语言显示文本
const currentLanguageLabel = computed(() => {
  const lang = locale.value || 'zh-CN';
  const option = languageOptions.value.find((item) => item.key === lang);
  return option?.label;
});

// 处理语言切换
function handleSelectLanguage(key: string) {
  locale.value = key;
}
</script>

<template>
  <n-dropdown trigger="click" placement="bottom-end" size="small" :options="languageOptions" @select="handleSelectLanguage" class="webcut-lang-switch-dropdown">
    <n-button text :focusable="false" size="tiny" class="webcut-lang-switch">
      <template #icon>
        <n-icon>
          <Translate />
        </n-icon>
      </template>
      <span>{{ currentLanguageLabel }}</span>
    </n-button>
  </n-dropdown>
</template>

<style scoped>
.webcut-lang-switch {
  font-size: 0.7em;
}
:global(.webcut-lang-switch-dropdown) {
  font-size: 12px;
}
</style>

