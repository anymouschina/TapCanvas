<script setup lang="ts">
import { WebCutSegment, WebCutRail } from '../../../types';
import { computed } from 'vue';
import { useWebCutContext } from '../../../hooks';
import { useT } from '../../../hooks/i18n';
import { useWebCutManager } from '../../../hooks/manager';
import ContextMenu from '../../../components/context-menu/index.vue';
import { useWebCutHistory } from '../../../hooks/history';

const t = useT();

const props = defineProps<{
    segment: WebCutSegment;
    rail: WebCutRail;
    railIndex: number;
    segmentIndex: number;
    segments: WebCutSegment[]
}>();

const { sources } = useWebCutContext();
const { deleteSegment } = useWebCutManager();
const { push: pushHistory } = useWebCutHistory();

const source = computed(() => {
    const key = props.segment.sourceKey;
    const source = sources.value.get(key);
    return source;
});

const contextmenus = computed(() => [
    {
        label: t('删除'),
        key: 'delete',
    },
]);

async function handleSelectContextMenu(key: string) {
    if (key === 'delete') {
        deleteSegment({ segment: props.segment, rail: props.rail });
        await pushHistory();
    }
}
</script>

<template>
    <context-menu :options="contextmenus" auto-hide v-slot="{ showContextMenus }" @select="handleSelectContextMenu">
        <div class="webcut-text-segment" @contextmenu.capture.stop="showContextMenus">
            {{ source?.text }}
        </div>
    </context-menu>
</template>

<style scoped>
.webcut-text-segment {
    height: 100%;
    width: 100%;
    font-size: .8em;
    display: flex;
    align-items: center;
    text-indent: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
</style>