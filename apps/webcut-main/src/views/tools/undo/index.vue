<script setup lang="ts">
import { NIcon, NPopover, NButton } from 'naive-ui';
import { Undo } from '@vicons/carbon';
import { useWebCutHistory } from '../../../hooks/history';
import { useT } from '../../../hooks/i18n';

const { canUndo, undo } = useWebCutHistory();
const t = useT();
</script>

<template>
    <n-popover :delay="200" class="webcut-tooltip">
        <template #trigger>
            <n-button quaternary size="small" :focusable="false" @click="undo" class="webcut-tool-button" :disabled="!canUndo">
                <template #icon>
                    <n-icon :component="Undo" size="16px"></n-icon>
                </template>
            </n-button>
        </template>
        <small>{{ t('撤销') }}</small>
    </n-popover>
</template>
