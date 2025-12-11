<script setup lang="ts">
import { NForm, NFormItem, NColorPicker, NInputNumber, NRadioGroup, NRadioButton, NIcon, NInputGroup, NButton, NSwitch, NInput, NDivider } from 'naive-ui';
import LocalFontSelect from '../../../components/system-fonts/index.vue';
import { TextAlignLeft, TextAlignCenter, TextAlignRight, TextAlignJustify } from '@vicons/carbon';
import { nextTick } from 'vue';
import { useWebCutContext, useWebCutPlayer } from '../../../hooks';
import { ref, watch } from 'vue';
import { clone, throttle } from 'ts-fns';
import { useT } from '../../../hooks/i18n';
import { useWebCutHistory } from '../../../hooks/history';
const { currentSource, currentSegment, height } = useWebCutContext();
const { updateText } = useWebCutPlayer();
const { push: pushHistory } = useWebCutHistory();
const t = useT();

const text = ref('');
const cssData = ref<any>({});
const marginBottom = ref();

const AlignIcons: any = {
    left: TextAlignLeft,
    center: TextAlignCenter,
    right: TextAlignRight,
    justify: TextAlignJustify,
};

const throttleUpdateText = throttle(async (sourceKey: string, data: any) => {
    await updateText(sourceKey, data);
    await pushHistory();
}, 200);
// 节流保存历史记录，避免频繁操作时过度保存
const throttledPushHistory = throttle(pushHistory, 200);

let isSyncing = false;
watch(currentSource, () => {
    if (!currentSource.value) {
        return;
    }
    isSyncing = true;
    const { text: txt, meta, sprite } = currentSource.value;
    text.value = txt!;
    cssData.value = clone(meta.text?.css!);
    const { y, h } = sprite.rect;
    marginBottom.value = height.value - (y + h);
    nextTick(() => {
        isSyncing = false;
    });
}, { immediate: true });

watch(text, (text) => {
    if (isSyncing) {
        return;
    }
    if (!currentSegment.value) {
        return;
    }
    const { sourceKey } = currentSegment.value;
    throttleUpdateText(sourceKey, { text });
});

watch(cssData, (css) => {
    if (isSyncing) {
        return;
    }
    if (!currentSegment.value) {
        return;
    }
    const { sourceKey } = currentSegment.value;
    throttleUpdateText(sourceKey, { css });
}, { deep: true });

watch(marginBottom, () => {
    if (isSyncing) {
        return;
    }
    if (!currentSource.value) {
        return;
    }
    const { sprite } = currentSource.value;
    const { rect } = sprite;
    const { h } = rect;
    const newY = height.value - marginBottom.value - h;
    rect.y = newY;
    // 保存到历史记录
    throttledPushHistory();
});

async function handleSetVerticalMiddle() {
    if (!currentSource.value) {
        return;
    }
    const { sprite } = currentSource.value;
    const { rect } = sprite;
    const { h } = rect;

    isSyncing = true;
    marginBottom.value = (height.value - h) / 2;
    await nextTick();
    isSyncing = false;

    // 保存到历史记录
    await pushHistory();
}

async function handleSetVerticalBottom() {
    isSyncing = true;
    marginBottom.value = 0;
    await nextTick();
    isSyncing = false;

    // 保存到历史记录
    await pushHistory();
}
</script>

<template>
    <n-form size="small" label-placement="left" :label-width="60" label-align="right" class="webcut-panel-form">
        <n-form-item :label="t('文本')">
            <n-input type="textarea" v-model:value="text"></n-input>
        </n-form-item>
        <n-form-item :label="t('颜色')">
            <n-color-picker v-model:value="cssData.color" default-value="rgba(255,255,255,1)" :modes="['rgb']"></n-color-picker>
        </n-form-item>
        <n-form-item :label="t('字体')">
            <local-font-select v-model:value="cssData['font-family']"></local-font-select>
        </n-form-item>
        <n-form-item :label="t('大写')">
            <n-switch v-model:value="cssData['text-transform']" checked-value="uppercase" unchecked-value="none" />
        </n-form-item>
        <n-form-item :label="t('字号')">
            <n-input-number v-model:value="cssData['font-size']" :min="1" :max="300"></n-input-number>
        </n-form-item>
        <n-form-item :label="t('背景色')">
            <n-color-picker v-model:value="cssData['background-color']" default-value="rgba(255,255,255,0)" :modes="['rgb']"></n-color-picker>
        </n-form-item>
        <n-form-item :label="t('圆角')">
            <n-input-number v-model:value="cssData['border-radius']" :min="0"></n-input-number>
        </n-form-item>
        <n-form-item :label="t('内边距')">
            <n-input-number v-model:value="cssData['padding']" :min="0"></n-input-number>
        </n-form-item>
        <n-form-item :label="t('描边')">
            <n-input-group>
                <n-color-picker v-model:value="cssData['--text-stroke-color']" default-value="rgba(255,255,255,1)" :modes="['rgb']"></n-color-picker>
                <n-input-number v-model:value="cssData['--text-stroke-width']" :min="0" :max="20"></n-input-number>
            </n-input-group>
        </n-form-item>
        <n-form-item :label="t('对齐')">
            <n-radio-group v-model:value="cssData['text-align']">
                <n-radio-button v-for="option in Object.keys(AlignIcons)" :key="option" :value="option">
                    <n-icon :component="AlignIcons[option]"></n-icon>
                </n-radio-button>
            </n-radio-group>
        </n-form-item>
        <n-divider></n-divider>
        <n-form-item :label="t('底边距')">
            <n-input-group>
                <n-input-number v-model:value="marginBottom" :min="0"></n-input-number>
                <n-button type="default" tertiary @click="handleSetVerticalBottom">{{ t('紧贴底边') }}</n-button>
                <n-button type="default" tertiary @click="handleSetVerticalMiddle">{{ t('垂直居中') }}</n-button>
            </n-input-group>
        </n-form-item>
    </n-form>
</template>
