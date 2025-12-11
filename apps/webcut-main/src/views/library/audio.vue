<script setup lang="ts">
import { ref, nextTick, computed } from 'vue';
import {
  NButton,
  NIcon,
  NUpload,
  NUploadDragger,
  NDropdown,
} from 'naive-ui';
import { Add, Upload } from '@vicons/carbon';
import { useWebCutLibrary } from '../../hooks/library';
import ScrollBox from '../../components/scroll-box/index.vue';
import { useWebCutPlayer } from '../../hooks';
import { useWebCutLocalFile } from '../../hooks/local-file';
import { useT } from '../../hooks/i18n';
import { useWebCutHistory } from '../../hooks/history';

const t = useT();

const { push } = useWebCutPlayer();
const { projectFiles, files, addNewFile, removeFile } = useWebCutLibrary();
const { fileUrl } = useWebCutLocalFile();
const { push: pushHistory } = useWebCutHistory();

const allAudioList = computed(() => {
  const items = files.value.filter((file) => file.type.startsWith('audio/')).sort((a, b) => (b.time || 0) - (a.time || 0));
  return items;
});
const projectAudioList = computed(() => {
  const items = projectFiles.value.filter((file) => file.type.startsWith('audio/')).sort((a, b) => (b.time || 0) - (a.time || 0));
  return items;
});

const actionType = ref<'import' | 'this' | 'all'>('this');

// 右键菜单相关状态
const showDropdown = ref(false);
const x = ref(0);
const y = ref(0);
const currentFile = ref<any>(null);

// 右键菜单选项
const options = computed(() => [
  {
    label: t('删除'),
    key: 'delete'
  }
]);

async function handleFileChange(e: any) {
  const file = e.file.file;
  await addNewFile(file);
  actionType.value = 'this';
}

function handleClickAudio(id: string) {
  const audio = document.getElementById(id) as HTMLAudioElement;
  if (audio.paused) {
    audio.play();
  } else {
    audio.pause();
  }
}

function onLeaveAudio(id: string) {
  const audio = document.getElementById(id) as HTMLAudioElement;
  audio.pause();
}

// 处理右键菜单点击
function handleContextMenu(e: MouseEvent, file: any) {
  e.preventDefault();
  showDropdown.value = false;
  currentFile.value = file;
  nextTick().then(() => {
    showDropdown.value = true;
    x.value = e.clientX;
    y.value = e.clientY;
  });
}

// 处理菜单项选择
function handleSelect(key: string | number) {
  showDropdown.value = false;
  if (key === 'delete' && currentFile.value) {
    removeFile(currentFile.value.id);
  }
}

// 点击外部关闭菜单
function onClickoutside() {
  showDropdown.value = false;
}

async function handleAdd(material: any) {
  try {
    const { id } = material;
    await push('audio', `file:${id}`);
    await pushHistory();
  }
  catch (e) {
    console.error(e);
  }
}
</script>

<template>
  <div class="webcut-material-panel">
    <aside class="webcut-material-panel-aside">
      <div class="webcut-material-panel-aside-btn" :class="{ 'webcut-material-panel-aside-btn--active': actionType === 'this' }" @click="actionType = 'this'">{{ t('当前') }}</div>
      <div class="webcut-material-panel-aside-btn" :class="{ 'webcut-material-panel-aside-btn--active': actionType === 'import' }" @click="actionType = 'import'">{{ t('导入') }}</div>
      <div class="webcut-material-panel-aside-btn" :class="{ 'webcut-material-panel-aside-btn--active': actionType === 'all' }" @click="actionType = 'all'">{{ t('全部') }}</div>
    </aside>

    <!-- 右侧素材列表 -->
    <main class="webcut-material-panel-main">
      <div class="webcut-meterial-panel-upload" v-if="actionType === 'import'">
        <n-upload multiple :show-file-list="false" accept=".mp3,.wav,.ogg,.flac,.m4a" @change="handleFileChange">
          <n-upload-dragger>
            <div>
              <n-icon :component="Upload" size="large"></n-icon>
            </div>
            <div>{{ t('拖拽音频到这里') }}</div>
            <div><small>{{ t('或者点击上传') }}</small></div>
          </n-upload-dragger>
        </n-upload>
      </div>

      <scroll-box class="webcut-material-container" v-if="actionType === 'this'">
        <div class="webcut-material-list">
          <div v-for="file in projectAudioList" :key="file.id" class="webcut-material-item" @contextmenu.stop="handleContextMenu($event, file)">
            <div class="webcut-material-preview" @mouseleave="onLeaveAudio(file.id)">
              <div class="webcut-audio-placeholder" @click="handleClickAudio(file.id)">
                <span class="webcut-audio-icon">🎵</span>
              </div>
              <audio :src="fileUrl(file.id)" class="webcut-material-audio" :id="file.id"></audio>
              <n-button class="webcut-add-button" size="tiny" type="primary" circle @click="handleAdd(file)">
                <template #icon>
                  <n-icon>
                    <Add />
                  </n-icon>
                </template>
              </n-button>
            </div>
            <div class="webcut-material-title">
              {{ file.name }}
            </div>
          </div>
          <div v-if="projectAudioList.length === 0" class="webcut-empty-materials">
            {{ t('暂无素材，请先导入素材') }}
          </div>
        </div>
      </scroll-box>

      <scroll-box class="webcut-material-container" v-if="actionType === 'all'">
        <div class="webcut-material-list">
          <div v-for="file in allAudioList" :key="file.id" class="webcut-material-item">
            <div class="webcut-material-preview" @mouseleave="onLeaveAudio(file.id)">
              <div class="webcut-audio-placeholder" @click="handleClickAudio(file.id)">
                <span class="webcut-audio-icon">🎵</span>
              </div>
              <audio :src="fileUrl(file.id)" class="webcut-material-audio" :id="file.id"></audio>
              <n-button class="webcut-add-button" size="tiny" type="primary" circle @click.stop="handleAdd(file)">
                <template #icon>
                  <n-icon>
                    <Add />
                  </n-icon>
                </template>
              </n-button>
            </div>
            <div class="webcut-material-title">
              {{ file.name }}
            </div>
          </div>
          <div v-if="allAudioList.length === 0" class="webcut-empty-materials">
            {{ t('暂无素材，请先导入素材') }}
          </div>
        </div>
      </scroll-box>
    </main>
  </div>

  <!-- 右键菜单组件 -->
  <n-dropdown placement="bottom-start" trigger="manual" :x="x" :y="y" :options="options" :show="showDropdown"
    :on-clickoutside="onClickoutside" size="small" @select="handleSelect" />
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
}

.webcut-material-item:hover .webcut-material-preview {
  box-shadow: 0 0 4px var(--webcut-grey-deep-color);
}

.webcut-material-item .webcut-material-preview .webcut-audio-icon {
  transition: transform 0.3s ease;
}

.webcut-material-item:hover .webcut-material-preview .webcut-audio-icon {
  transform: scale(1.05);
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
  cursor: default;
}

.webcut-material-title {
  font-size: .6em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 4px;
}

.webcut-audio-placeholder {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.webcut-audio-icon {
  font-size: 2em;
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

.webcut-empty-materials {
  margin-top: 12px;
  margin-left: 24px;
  font-size: .8em;
  opacity: .6;
}

.webcut-material-container {
  height: 100%;
  overflow: auto;
}
</style>