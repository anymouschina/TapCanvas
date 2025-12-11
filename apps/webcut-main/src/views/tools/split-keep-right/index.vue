<script setup lang="ts">
import { NIcon, NPopover, NButton } from 'naive-ui';
import { PanelRight16Filled } from '@vicons/fluent';
import { useWebCutContext } from '../../../hooks';
import { useWebCutHistory } from '../../../hooks/history';
import { useWebCutManager } from '../../../hooks/manager';
import { useT } from '../../../hooks/i18n';
import { computed } from 'vue';

const { rails, selected, current, cursorTime } = useWebCutContext();
const { splitSegment } = useWebCutManager();
const { push: pushHistory } = useWebCutHistory();
const t = useT();

const currentSelected = computed(() => {
    if (!current.value) {
        return;
    }
    const selectedItem = selected.value.find(item => item.segmentId === current.value)!;
    const { railId, segmentId } = selectedItem;
    const rail = rails.value.find(item => item.id === railId);
    if (!rail) {
        return;
    }
    const segment = rail.segments.find(item => item.id === segmentId);
    if (!segment) {
        return;
    }
    return { rail, segment };
});
const canSplit = computed(() => {
    if (!currentSelected.value) {
        return false;
    }
    const { segment } = currentSelected.value;
    const time = cursorTime.value;
    const { start, end } = segment;
    return time > start && time < end;
});

async function handleSplit() {
    if (!currentSelected.value) {
        return;
    }

    try {
        const { segment, rail } = currentSelected.value;
        await splitSegment({ segment, rail, keep: 'right' });
        await pushHistory();
    }
    catch (e) {
        console.error(e);
    }
}
</script>

<template>
    <n-popover :delay="200" class="webcut-tooltip">
        <template #trigger>
            <n-button quaternary size="small" :focusable="false" @click="handleSplit" class="webcut-tool-button" :disabled="!current || !canSplit">
                <template #icon>
                    <n-icon :component="PanelRight16Filled" size="16px"></n-icon>
                </template>
            </n-button>
        </template>
        <small>{{ t('分割当前选中，只保留右侧') }}</small>
    </n-popover>
</template>
