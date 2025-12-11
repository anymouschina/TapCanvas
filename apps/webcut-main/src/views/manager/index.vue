<script setup lang="ts">
import ManagerContainer from './container/index.vue';
import AsideRail from './aside/index.vue';
import MainSegment from './main/index.vue';
import ToolBar from './tool-bar/index.vue';
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { useWebCutPlayer } from '../../hooks';
import { useWebCutManager } from '../../hooks/manager';

const { resize } = useWebCutPlayer();
const { resizeManagerMaxHeight } = useWebCutManager();

const root = ref();

function resizeHeight() {
    const height = root.value?.getBoundingClientRect().height - 28; // 28是工具栏的高度
    resizeManagerMaxHeight(height);
    resize();
}

const resizeObserver = new ResizeObserver(() => {
    resizeHeight();
});

onMounted(resizeHeight);
onMounted(() => {
    resizeObserver.observe(root.value);
});
onBeforeUnmount(() => {
    resizeObserver.disconnect();
});

defineExpose({
    resizeHeight,
});
</script>

<template>
    <div class="webcut-manager-root" ref="root">
        <ToolBar :aside-width="120" />
        <ManagerContainer disable-sort :aside-width="120" class="webcut-manager-container" :rail-height-by-type="{ audio: 32, text: 24 }">
            <template #asideRail="{ rail }">
                <AsideRail :rail="rail"></AsideRail>
            </template>
            <template #mainSegment="{ rail, segment, railIndex, segmentIndex, segments }">
                <MainSegment :rail="rail" :segment="segment" :railIndex="railIndex" :segmentIndex="segmentIndex" :segments="segments"></MainSegment>
            </template>
        </ManagerContainer>
    </div>
</template>

<style scoped>
.webcut-manager-root {
    height: 100%;
    display: flex;
    flex-direction: column;
}
.webcut-manager-container {
    flex: 1;
}
</style>