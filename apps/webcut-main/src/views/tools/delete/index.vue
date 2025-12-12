<script setup lang="ts">
import { NIcon, NPopover, NButton } from 'naive-ui';
import { Delete } from '@vicons/carbon';
import { useWebCutContext } from '../../../hooks';
import { useWebCutManager } from '../../../hooks/manager';
import { useWebCutHistory } from '../../../hooks/history';
import { useT } from '../../../hooks/i18n';

const { rails, selected, current, sources } = useWebCutContext();
const { deleteSegment } = useWebCutManager();
const { push: pushHistory } = useWebCutHistory();
const t = useT();

async function handleDelete() {
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

    const hasSource = !!sources.value.get(segment.sourceKey);

    deleteSegment({ segment, rail });
    if (hasSource) {
        await pushHistory();
    }
}
</script>

<template>
    <n-popover :delay="200" class="webcut-tooltip">
        <template #trigger>
            <n-button quaternary size="small" :focusable="false" @click="handleDelete" class="webcut-tool-button" :disabled="!current">
                <template #icon>
                    <n-icon :component="Delete" size="16px"></n-icon>
                </template>
            </n-button>
        </template>
        <small>{{ t('删除当前选中') }}</small>
    </n-popover>
</template>
