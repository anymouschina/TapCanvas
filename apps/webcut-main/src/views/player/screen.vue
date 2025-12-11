<script setup lang="ts">
import { watch, ref, watchEffect, onBeforeUnmount, onMounted, inject, nextTick } from 'vue';
import { useWebCutPlayer, useWebCutContext } from '../../hooks';
import { Evt } from '../../libs/evt';

const props = defineProps<{
    /** 最大宽度 */
    maxWidth?: number;
    /** 最大高度 */
    maxHeight?: number;
}>();

const { viewport, width, height, player } = useWebCutContext();
const { init, destroy } = useWebCutPlayer();
const canvasSizeRef = inject('videoCanvasSizeRef', null);

const box = ref();
const canvasMaxWidth = ref(0);
const canvasMaxHeight = ref(0);

watch(viewport, (el) => {
    if (el) {
        init();
    }
    else {
        destroy();
    }
}, { immediate: true });

function fitBoxSize() {
    if (!box.value) {
        return;
    }

    const canvasWidth = width.value;
    const canvasHeight = height.value;

    const { width: outerWidth, height: outerHeight } = box.value.getBoundingClientRect();
    const scale = Math.min(
        outerWidth / canvasWidth,
        outerHeight / canvasHeight,
        props.maxWidth ? props.maxWidth / canvasWidth : 1,
        props.maxHeight ? props.maxHeight / canvasHeight : 1,
    );
    if (scale < 1) {
        canvasMaxWidth.value = canvasWidth * scale;
        canvasMaxHeight.value = canvasHeight * scale;
    }

    if (canvasSizeRef) {
        nextTick(() => {
            const { width, height } = viewport.value!.getBoundingClientRect();
            // @ts-ignore
            canvasSizeRef.value = {
                width,
                height,
            };
        });
    }
}

watchEffect(fitBoxSize);

onMounted(() => {
    window.addEventListener('resize', fitBoxSize);
});

onBeforeUnmount(() => {
    window.removeEventListener('resize', fitBoxSize);
    destroy();
});

const evt = new Evt();
const exports = {
    fitBoxSize,
    on: evt.on.bind(evt),
    off: evt.off.bind(evt),
    once: evt.once.bind(evt),
    emit: evt.emit.bind(evt),
};
player.value = exports;
</script>

<template>
    <div class="webcut-box" ref="box">
        <div class="webcut-viewport" ref="viewport" :style="{
            width: width + 'px',
            height: height + 'px',
            maxWidth: canvasMaxWidth ? canvasMaxWidth + 'px' : undefined,
            maxHeight: canvasMaxHeight ? canvasMaxHeight + 'px' : undefined,
        }"></div>
    </div>
</template>

<style scoped>
.webcut-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
}
</style>