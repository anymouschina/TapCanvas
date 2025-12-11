<script setup lang="ts">
import { NIcon, NPopover, NButton } from 'naive-ui';
import { Broom16Regular } from '@vicons/fluent';
import { useWebCutContext } from '../../../hooks';
import { useT } from '../../../hooks/i18n';
import { useWebCutHistory } from '../../../hooks/history';

const { selected, current } = useWebCutContext();
const { push: pushHistory } = useWebCutHistory();
const t = useT();

async function handleClear() {
    selected.value = [];
    current.value = null;
    await pushHistory();
}
</script>

<template>
    <n-popover :delay="200" class="webcut-tooltip">
        <template #trigger>
            <n-button quaternary :focusable="false" @click="handleClear" class="webcut-tool-button" :disabled="selected.length === 0">
                <template #icon>
                    <n-icon :component="Broom16Regular" size="16px"></n-icon>
                </template>
            </n-button>
        </template>
        <small>{{ t('清除选中') }}</small>
    </n-popover>
</template>
