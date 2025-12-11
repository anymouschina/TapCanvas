<script setup lang="ts">
import { ref, provide } from 'vue';

const canvasSizeRef = ref<any>({});
provide('videoCanvasSizeRef', canvasSizeRef)
</script>

<template>
    <div class="webcut-player-container" :style="{
        '--webcut-width': canvasSizeRef.width ? canvasSizeRef.width + 'px' : '100%',
        '--webcut-height': canvasSizeRef.height ? canvasSizeRef.height + 'px' : '100%',
    }">
        <slot></slot>
    </div>
</template>

<style scoped>
.webcut-player-container {
    flex: 1;
    width: 100%;
    height: 100%;
}
.webcut-player-container :deep(.webcut-box:has(+ .webcut-player-button)) {
    height: calc(100% - 26px);
}
/** 迫使按钮紧贴画布 */
.webcut-player-container :deep(.webcut-player-button) {
    margin-top: calc(0px - (100% - var(--webcut-height)) / 2 + 26px + 8px) !important;
}
</style>