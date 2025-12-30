<script setup lang="ts">
import { computed } from 'vue';
import { WebCutEditor } from '../src';
import EmbedClipper from './EmbedClipper.vue';

const mode = computed(() => {
  if (typeof window === 'undefined') return 'editor';
  try {
    const url = new URL(window.location.href);
    const embed = url.searchParams.get('embed');
    const m = url.searchParams.get('mode');
    if (embed === '1' && m === 'clip') return 'clip';
  } catch {
    // ignore
  }
  return 'editor';
});
</script>

<template>
    <EmbedClipper v-if="mode === 'clip'" />
    <WebCutEditor v-else />
</template>
