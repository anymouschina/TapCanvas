<script setup lang="ts">
import { ref } from 'vue';
import { NTabs, NTabPane, NIcon } from 'naive-ui';
import { VideoClip16Filled, MusicNote220Filled, Image24Filled, TextField24Regular } from '@vicons/fluent';
import { WebCutMaterialType } from '../../types';
import { useT } from '../../hooks/i18n';

// 导入素材面板组件
import VideoPanel from './video.vue';
import AudioPanel from './audio.vue';
import ImagePanel from './image.vue';
import TextPanel from './text.vue';

// 当前激活的 tab
const activeTab = ref<WebCutMaterialType>('video');
const t = useT();

// 处理 tab 切换
const handleTabChange = (key: string) => {
  activeTab.value = key as WebCutMaterialType;
};
</script>

<template>
  <div class="webcut-library">
    <n-tabs v-model:active-key="activeTab" @update:active-key="handleTabChange" :tabs-padding="8" size="small" type="line" class="webcut-library-tabs">
      <n-tab-pane name="video">
        <template #tab>
            <div class="webcut-library-tab">
                <n-icon :component="VideoClip16Filled"></n-icon>
                <span>{{ t('视频') }}</span>
            </div>
        </template>
        <VideoPanel />
      </n-tab-pane>
      <n-tab-pane name="audio">
        <template #tab>
            <div class="webcut-library-tab">
                <n-icon :component="MusicNote220Filled"></n-icon>
                <span>{{ t('音频') }}</span>
            </div>
        </template>
        <AudioPanel />
      </n-tab-pane>
      <n-tab-pane name="image">
        <template #tab>
            <div class="webcut-library-tab">
                <n-icon :component="Image24Filled"></n-icon>
                <span>{{ t('图片') }}</span>
            </div>
        </template>
        <ImagePanel />
      </n-tab-pane>
      <n-tab-pane name="text">
        <template #tab>
            <div class="webcut-library-tab">
                <n-icon :component="TextField24Regular"></n-icon>
                <span>{{ t('文本') }}</span>
            </div>
        </template>
        <TextPanel />
      </n-tab-pane>
    </n-tabs>
  </div>
</template>

<style scoped lang="less">
.webcut-library {
  width: 100%;
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.webcut-library-tabs {
  height: 100%;
  overflow: hidden;

  :deep(.n-tab-pane) {
    overflow: hidden;
  }
}

.webcut-library-tab {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;

    span {
        font-size: .6em;
    }

    :deep(.n-icon) {
        font-size: 18px;
    }
}
</style>
