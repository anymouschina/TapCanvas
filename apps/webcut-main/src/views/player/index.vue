<script setup lang="ts">
import { ref, provide } from 'vue';
import Screen from './screen.vue';
import Button from './button.vue';

const props = defineProps<{
    displaySkipButtons?: boolean;
    /** 最大宽度 */
    maxWidth?: number;
    /** 最大高度 */
    maxHeight?: number;
}>();

const canvasSizeRef = ref<any>({});
provide('videoCanvasSizeRef', canvasSizeRef);
</script>

<template>
    <div class="webcut-player-container" :style="{
        '--webcut-width': canvasSizeRef.width ? canvasSizeRef.width + 'px' : '100%',
        '--webcut-height': canvasSizeRef.height ? canvasSizeRef.height + 'px' : '100%',
    }">
        <Screen :max-height="props.maxHeight" :max-width="props.maxWidth"></Screen>
        <Button :display-skip-buttons="props.displaySkipButtons"></Button>
    </div>
</template>

<style scoped>
.webcut-player-container {
    flex: 1;
    width: 100%;
    height: 100%;
    position: relative;
}
.webcut-player-container :deep(.webcut-box:has(+ .webcut-player-button)) {
    height: calc(100% - 26px);
}
/** 迫使按钮紧贴画布 */
.webcut-player-container :deep(.webcut-player-button) {
    position: absolute;
    /* margin-top: calc(0px - (100% - var(--webcut-height)) / 2 + 26px + 8px) !important; */
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    margin-top: calc(var(--webcut-height) / 2 + 8px) !important;
}
</style>