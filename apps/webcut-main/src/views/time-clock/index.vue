<script setup lang="ts">
import { formatTime } from '../../libs';
import { useWebCutContext } from '../../hooks';

const { duration, cursorTime } = useWebCutContext();
</script>

<template>
    <div class="webcut-time-clock">
        <span class="webcut-time-clock-text">{{ formatTime(cursorTime) }}</span>
        <span class="webcut-time-clock-separator">/</span>
        <span class="webcut-time-clock-text">{{ formatTime(duration) }}</span>
    </div>
</template>

<style scoped>
.webcut-time-clock {
    display: flex;
    align-items: center;
    font-size: .7em;
}
.webcut-time-clock-text {
    display: inline-block;
    width: 66px;
}
.webcut-time-clock-separator {
    margin: 0 4px;
}
</style>