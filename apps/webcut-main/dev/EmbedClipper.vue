<script setup lang="ts">
import { computed } from 'vue';
import WebCutProvider from '../src/views/provider/index.vue';
import EmbedClipperInner from './EmbedClipperInner.vue';

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

const providerData = computed(() => ({ id: projectId.value }));
</script>

<template>
  <WebCutProvider :data="providerData">
    <EmbedClipperInner
      :request-id="requestId"
      :video-url="videoUrl"
      :parent-origin="parentOrigin"
    />
  </WebCutProvider>
</template>

