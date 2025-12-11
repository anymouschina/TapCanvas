<script setup lang="ts">
import { PauseFilled, StopFilledAlt, PlayFilledAlt, SkipForwardFilled, SkipBackFilled } from '@vicons/carbon';
import { useWebCutContext, useWebCutPlayer } from '../../hooks';
import { NIcon, NButton } from 'naive-ui';

const props = defineProps<{
    displaySkipButtons?: boolean;
}>();

const { status, sprites, cursorTime, duration, fps } = useWebCutContext();
const { play, pause, reset, moveTo } = useWebCutPlayer();

const iconMap = {
    [-1]: StopFilledAlt,
    0: PlayFilledAlt,
    1: PauseFilled,
};
const fnMap = {
    [-1]: reset,
    0: play,
    1: pause,
};

function skipForward() {
    moveTo(duration.value - fps.value);
}
</script>

<template>
    <div class="webcut-player-button">
        <n-button text @click="reset" v-if="status === 0 && props.displaySkipButtons" :disabled="cursorTime === 0" :focusable="false">
            <n-icon :component="SkipBackFilled" size="large" class="webcut-player-button-icon"></n-icon>
        </n-button>
        <n-button text :disabled="!sprites.length" @click="fnMap[status]()" :focusable="false">
            <n-icon :component="iconMap[status]" size="large" class="webcut-player-button-icon"></n-icon>
        </n-button>
        <n-button text @click="skipForward" v-if="status === 0 && props.displaySkipButtons" :disabled="cursorTime >= duration - fps" :focusable="false">
            <n-icon :component="SkipForwardFilled" size="large" class="webcut-player-button-icon"></n-icon>
        </n-button>
    </div>
</template>

<style scoped lang="less">
.webcut-player-button {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 16px;
    position: relative;

    .webcut-box + & {
        margin-top: 8px;
    }
}
</style>