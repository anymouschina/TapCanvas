<script setup lang="ts">
import { WebCutRail, WebCutSegment } from '../../../types';
import VideoSegment from '../segments/video.vue';
import AudioSegment from '../segments/audio.vue';
import ImageSegment from '../segments/image.vue';
import TextSegment from '../segments/text.vue';

defineProps<{
    rail: WebCutRail;
    segment: WebCutSegment;
    railIndex: number;
    segmentIndex: number;
    segments: WebCutSegment[];
}>();
</script>

<template>
    <div class="webcut-manager-segment">
        <VideoSegment v-if="rail.type === 'video'" :segment="segment" :rail="rail" :railIndex="railIndex" :segmentIndex="segmentIndex" :segments="segments"></VideoSegment>
        <AudioSegment v-if="rail.type === 'audio'" :segment="segment" :rail="rail" :railIndex="railIndex" :segmentIndex="segmentIndex" :segments="segments"></AudioSegment>
        <ImageSegment v-if="rail.type === 'image'" :segment="segment" :rail="rail" :railIndex="railIndex" :segmentIndex="segmentIndex" :segments="segments"></ImageSegment>
        <TextSegment v-if="rail.type === 'text'" :segment="segment" :rail="rail" :railIndex="railIndex" :segmentIndex="segmentIndex" :segments="segments"></TextSegment>
    </div>
</template>

<style scoped>
.webcut-manager-segment {
    width: 100%;
    height: 100%;
}
</style>