<script setup lang="ts">
import { NSelect, useMessage } from 'naive-ui';
import { loadLocalFonts } from './utils';
import { ref, h } from 'vue';
import { asyncOf } from '../../libs/async';

const value = defineModel<any>('value', { required: true });
const toast = useMessage();

const loading = ref(false);
const options = ref([]);

async function handleLoadFonts() {
    loading.value = true;
    const [err, fonts] = await asyncOf(loadLocalFonts());
    loading.value = false;

    if (err) {
        toast.error(err.message);
        return;
    }

    const items = fonts.map((font: any) => {
        return {
            label: font.fullName,
            value: font.postscriptName,
        };
    });
    options.value = items;
}

function renderLabel(item: any) {
    // const { fontFace } = useLocalFont(item.value);
    return h('span', {
        style: {
            'font-family': `"${item.value}"`,
            // '--font-family': fontFace.fontFamily,
            // '--font-src': fontFace.src,
        },
    }, item.label);
}
</script>

<template>
    <n-select
        v-model:value="value"
        :options="options"
        filterable
        :loading="loading"
        :render-label="renderLabel"
        @focus="handleLoadFonts"
        class="system-font-select"
    >
    </n-select>
</template>
