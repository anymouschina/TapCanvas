<script setup lang="ts">
import { ref } from 'vue';
import {
  NButton,
  NIcon,
} from 'naive-ui';
import { Add } from '@vicons/carbon';
import { useWebCutPlayer } from '../../hooks';
import { useT } from '../../hooks/i18n';
import { useWebCutHistory } from '../../hooks/history';

const { push } = useWebCutPlayer();
const { push: pushHistory } = useWebCutHistory();
const actionType = ref<'create'>('create');
const t = useT();

async function handleAdd() {
  await push('text', t('默认文本'));
  await pushHistory();
}
</script>

<template>
  <div class="webcut-material-panel">
    <aside class="webcut-material-panel-aside">
      <div class="webcut-material-panel-aside-btn" :class="{ 'webcut-material-panel-aside-btn--active': actionType === 'create' }" @click="actionType = 'create'">{{ t('新建文本') }}</div>
      <div class="webcut-material-panel-aside-btn" style="opacity: .4;">{{ t('花字库') }}</div>
    </aside>

    <!-- 右侧素材列表 -->
    <main class="webcut-material-panel-main">
      <div class="webcut-material-list" v-if="actionType === 'create'">
        <div class="webcut-material-item">
          <div class="webcut-material-preview">
            <div>{{ t('默认文本') }}</div>
            <n-button class="webcut-add-button" size="tiny" type="primary" circle @click="handleAdd">
              <template #icon>
                <n-icon>
                  <Add />
                </n-icon>
              </template>
            </n-button>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped lang="less">
.webcut-material-panel {
  display: flex;
  height: 100%;
  margin: 0 4px;
}

.webcut-material-panel-aside {
  width: 60px;
  min-width: 60px;
}

.webcut-material-panel-aside-btn {
  background: var(--webcut-grey-deep-color);
  margin: 2px;
  border-radius: 4px;
  font-size: .7em;
  padding: 2px 4px;
  cursor: pointer;

  &--active {
    background-color: var(--webcut-grey-color);
  }
}

.webcut-material-panel-main {
  flex: 1;
  margin-left: 8px;
}

.webcut-material-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-bottom: 16px;
}

.webcut-material-item {
  width: 100px;
  border-radius: 16px;
}

.webcut-material-item:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.webcut-material-preview {
  width: 100px;
  height: 70px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--webcut-grey-deep-color);
  border-radius: 8px;
  border: 1px solid var(--border-color);
  overflow: hidden;
  position: relative;
}

.webcut-material-title {
  font-size: .6em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 4px;
}

.webcut-material-image {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.webcut-add-button {
  position: absolute;
  bottom: 4px;
  right: 4px;
  width: 12px;
  height: 12px;
  z-index: 10;
  opacity: 0;
  transition: all 0.3s ease;
}

.webcut-material-item:hover .webcut-add-button {
  opacity: 1;
}

.webcut-material-container {
  height: 100%;
  overflow: auto;
}
</style>