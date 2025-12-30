<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { NButton, NIcon } from 'naive-ui';
import { Checkmark, Close } from '@vicons/carbon';
import WebCutProvider from '../src/views/provider/index.vue';
import WebCutPlayerScreen from '../src/views/player/screen.vue';
import WebCutPlayerButton from '../src/views/player/button.vue';
import WebCutManager from '../src/views/manager/index.vue';
import { useWebCutContext, useWebCutPlayer } from '../src/hooks';

function getQueryParam(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return new URL(window.location.href).searchParams.get(key);
  } catch {
    return null;
  }
}

const requestId = computed(() => getQueryParam('requestId') || '');
const videoUrl = computed(() => getQueryParam('videoUrl') || '');
const parentOrigin = computed(() => getQueryParam('parentOrigin') || '*');
const projectId = computed(() => (requestId.value ? `tapcanvas_clip_${requestId.value}` : 'tapcanvas_clip_default'));

const exporting = ref(false);
const exportError = ref<string | null>(null);

useWebCutContext(() => (projectId.value ? { id: projectId.value } : undefined));

const { clear, push, exportBlob } = useWebCutPlayer();

async function initSingleVideo() {
  if (!videoUrl.value) return;
  exportError.value = null;
  try {
    clear();
    await push('video', videoUrl.value, { autoFitRect: 'contain' });
  } catch (e: any) {
    const msg = typeof e?.message === 'string' ? e.message : 'Failed to load video';
    exportError.value = msg.includes('Unauthorized') ? 'Unauthorized: missing/expired token (tap_token)' : msg;
  }
}

async function exportToParent() {
  if (exporting.value) return;
  exportError.value = null;
  exporting.value = true;
  try {
    const blob = await exportBlob();
    const buffer = await blob.arrayBuffer();
    const payload = {
      type: 'webcut:export',
      requestId: requestId.value,
      mime: 'video/mp4',
      filename: 'clip.mp4',
      buffer,
    };
    window.parent?.postMessage(payload, parentOrigin.value || '*', [buffer]);
  } catch (e: any) {
    exportError.value = typeof e?.message === 'string' ? e.message : 'Export failed';
  } finally {
    exporting.value = false;
  }
}

function cancel() {
  window.parent?.postMessage({ type: 'webcut:cancel', requestId: requestId.value }, parentOrigin.value || '*');
}

onMounted(() => {
  initSingleVideo();
});

onBeforeUnmount(() => {
  // avoid leaks if webcut hooks hold global context
  try {
    clear();
  } catch {
    // ignore
  }
});
</script>

<template>
  <WebCutProvider>
    <div class="webcut-embed-clipper">
      <div class="webcut-embed-clipper-topbar">
        <div class="webcut-embed-clipper-topbar-left">
          <div class="webcut-embed-clipper-title">WebCut Clipper (TapCanvas)</div>
          <div class="webcut-embed-clipper-subtitle">Only editing current selected node video</div>
        </div>
        <div class="webcut-embed-clipper-topbar-right">
          <n-button size="small" quaternary :disabled="exporting" @click="cancel">
            <template #icon>
              <n-icon><Close /></n-icon>
            </template>
            Cancel
          </n-button>
          <n-button size="small" type="primary" :loading="exporting" :disabled="!requestId || !videoUrl" @click="exportToParent">
            <template #icon>
              <n-icon><Checkmark /></n-icon>
            </template>
            Apply
          </n-button>
        </div>
      </div>

      <div class="webcut-embed-clipper-main">
        <div class="webcut-embed-clipper-player">
          <WebCutPlayerScreen class="webcut-embed-clipper-player-screen" />
          <div class="webcut-embed-clipper-player-controls">
            <WebCutPlayerButton />
          </div>
        </div>
        <div class="webcut-embed-clipper-timeline">
          <WebCutManager />
        </div>
      </div>

      <div v-if="exportError" class="webcut-embed-clipper-error">
        {{ exportError }}
      </div>
    </div>
  </WebCutProvider>
</template>

<style scoped>
.webcut-embed-clipper {
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
}
.webcut-embed-clipper-topbar {
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  border-bottom: 1px solid var(--webcut-line-color);
  background: var(--webcut-background-color);
  color: var(--text-color-base);
}
.webcut-embed-clipper-topbar-left {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.webcut-embed-clipper-title {
  font-size: 13px;
  font-weight: 600;
}
.webcut-embed-clipper-subtitle {
  font-size: 11px;
  opacity: 0.6;
}
.webcut-embed-clipper-topbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.webcut-embed-clipper-main {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-rows: 1fr 280px;
}
.webcut-embed-clipper-player {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 12px;
  gap: 8px;
  background: #000;
}
.webcut-embed-clipper-player-screen {
  width: 100%;
  height: 100%;
}
.webcut-embed-clipper-player-controls {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
}
.webcut-embed-clipper-timeline {
  min-height: 0;
  background: var(--webcut-background-color);
}
.webcut-embed-clipper-error {
  padding: 8px 12px;
  color: #ffb4b4;
  background: rgba(255, 0, 0, 0.08);
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 12px;
}
</style>
