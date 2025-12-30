<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, nextTick } from 'vue';
import { NButton, NIcon } from 'naive-ui';
import { Checkmark, Close } from '@vicons/carbon';
import WebCutPlayerScreen from '../src/views/player/screen.vue';
import WebCutPlayerButton from '../src/views/player/button.vue';
import WebCutManager from '../src/views/manager/index.vue';
import { useWebCutContext, useWebCutPlayer } from '../src/hooks';
import { getAuthToken } from '../src/libs/auth';

const props = defineProps<{
  requestId: string;
  videoUrl: string;
  parentOrigin: string;
}>();

const exporting = ref(false);
const exportError = ref<string | null>(null);
const hasPushed = ref(false);

const { viewport, sprites, rails, loading } = useWebCutContext();
const { clear, push, exportBlob, moveTo, pause } = useWebCutPlayer();

const normalizedParentOrigin = computed(() => props.parentOrigin || '*');
const showDebug = computed(() => {
  if (typeof window === 'undefined') return false;
  try {
    const url = new URL(window.location.href);
    return url.searchParams.get('debug') === '1';
  } catch {
    return false;
  }
});

async function initSingleVideo() {
  if (!props.videoUrl) return;
  exportError.value = null;
  hasPushed.value = false;

  const token = getAuthToken();
  if (!token) {
    exportError.value = 'Missing tap_token: open this clipper from TapCanvas (so it can inject the token).';
    return;
  }

  try {
    // Preflight to surface auth/proxy errors early.
    const pre = await fetch(props.videoUrl, {
      method: 'GET',
      credentials: 'include',
      headers: {
        Authorization: `Bearer ${token}`,
        Range: 'bytes=0-1',
      },
    });
    if (!pre.ok) {
      exportError.value = `proxy-video preflight failed: ${pre.status}`;
      return;
    }
    const ct = (pre.headers.get('content-type') || '').toLowerCase();
    if (ct && !ct.startsWith('video/') && !ct.includes('mp4') && !ct.includes('octet-stream')) {
      exportError.value = `proxy-video returned non-video content-type: ${ct}`;
      return;
    }

    clear();
    // Disable audio in embed mode to avoid user-gesture autoplay restrictions impacting init.
    await push('video', props.videoUrl, { autoFitRect: 'contain', video: { volume: 0 } });
    hasPushed.value = true;

    // Render first frame
    await nextTick();
    pause();
    moveTo(0);
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error('[webcut-embed-clipper] initSingleVideo failed', e);
    const msg = typeof e?.message === 'string' ? e.message : 'Failed to load video';
    exportError.value = msg.includes('Unauthorized') ? 'Unauthorized: missing/expired token (tap_token)' : msg;
  }
}

watch(viewport, (el) => {
  // If push happens before PlayerScreen finishes init, preview again after init.
  if (el && hasPushed.value) {
    try {
      pause();
      moveTo(0);
    } catch {
      // ignore
    }
  }
});

onMounted(() => {
  initSingleVideo();
});

onBeforeUnmount(() => {
  try {
    clear();
  } catch {
    // ignore
  }
});

async function exportToParent() {
  if (exporting.value) return;
  exportError.value = null;
  exporting.value = true;
  try {
    const blob = await exportBlob();
    const buffer = await blob.arrayBuffer();
    const payload = {
      type: 'webcut:export',
      requestId: props.requestId,
      mime: 'video/mp4',
      filename: 'clip.mp4',
      buffer,
    };
    window.parent?.postMessage(payload, normalizedParentOrigin.value || '*', [buffer]);
  } catch (e: any) {
    exportError.value = typeof e?.message === 'string' ? e.message : 'Export failed';
  } finally {
    exporting.value = false;
  }
}

function cancel() {
  window.parent?.postMessage({ type: 'webcut:cancel', requestId: props.requestId }, normalizedParentOrigin.value || '*');
}
</script>

<template>
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
        <n-button size="small" type="primary" :loading="exporting" :disabled="!props.requestId || !props.videoUrl" @click="exportToParent">
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

    <div v-if="showDebug" class="webcut-embed-clipper-debug">
      <div>loading: {{ loading ? '1' : '0' }} · sprites: {{ sprites.length }} · rails: {{ rails.length }} · pushed: {{ hasPushed ? '1' : '0' }}</div>
    </div>

    <div v-if="exportError" class="webcut-embed-clipper-error">
      {{ exportError }}
    </div>
  </div>
</template>

<style scoped>
.webcut-embed-clipper {
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
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
  overflow: hidden;
  grid-template-rows: 1fr clamp(160px, 32vh, 280px);
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
  overflow: hidden;
}
.webcut-embed-clipper-error {
  padding: 8px 12px;
  color: #ffb4b4;
  background: rgba(255, 0, 0, 0.08);
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 12px;
}
.webcut-embed-clipper-debug {
  padding: 6px 12px;
  font-size: 11px;
  opacity: 0.7;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

@media (max-width: 560px) {
  .webcut-embed-clipper-topbar {
    padding: 0 8px;
  }
  .webcut-embed-clipper-topbar-right {
    gap: 6px;
  }
  .webcut-embed-clipper-title {
    font-size: 12px;
  }
  .webcut-embed-clipper-subtitle {
    display: none;
  }
}

@media (max-height: 700px) {
  .webcut-embed-clipper-main {
    grid-template-rows: 1fr clamp(140px, 28vh, 220px);
  }
  .webcut-embed-clipper-player {
    padding: 8px;
  }
}
</style>
