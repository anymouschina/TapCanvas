<script setup lang="ts">
import { NIcon, NPopover, NButton } from 'naive-ui';
import { Redo } from '@vicons/carbon';
import { useWebCutHistory } from '../../../hooks/history';
import { useT } from '../../../hooks/i18n';

const { canRedo, redo } = useWebCutHistory();
const t = useT();
</script>

<template>
    <n-popover :delay="200" class="webcut-tooltip">
        <template #trigger>
            <n-button quaternary size="small" :focusable="false" @click="redo" class="webcut-tool-button" :disabled="!canRedo">
                <template #icon>
                    <n-icon :component="Redo" size="16px"></n-icon>
                </template>
            </n-button>
        </template>
        <small>{{ t('重做') }}</small>
    </n-popover>
</template>
