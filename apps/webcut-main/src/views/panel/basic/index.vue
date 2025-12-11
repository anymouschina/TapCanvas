<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useWebCutContext, useWebCutPlayer } from '../../../hooks';
import { NForm, NFormItem, NInputNumber, NInputGroup, NButton, NInputGroupLabel, NSlider, NAlert } from 'naive-ui';
import RotateInput from '../../../components/rotate-input/index.vue';
import { useT } from '../../../hooks/i18n';
import { autoFitRect } from '../../../libs';
import { ImgClip, MP4Clip } from '@webav/av-cliper';
import { useWebCutHistory } from '../../../hooks/history';
import { throttle } from 'ts-fns';

const { currentSource, width, height } = useWebCutContext();
const { push: pushHistory } = useWebCutHistory();
const { syncSourceMeta } = useWebCutPlayer();
const t = useT();

// 节流保存历史记录，避免频繁操作时过度保存
const throttledPushHistory = throttle(pushHistory, 500);

const formData = ref<any>({
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    angle: 0,
    opacity: 1,
});

let isSyncing = false;
function syncCanvasToForm(e: any) {
    const { rect } = e;
    if (!rect) {
        return;
    }

    isSyncing = true;
    const { x, y, w, h, angle } = rect;
    Object.keys({ x, y, w, h, angle }).forEach((key) => {
        if (typeof rect[key] !== 'number') {
            return;
        }
        formData.value[key] = rect[key];
    });
    // Sync opacity from sprite
    if (currentSource.value) {
        formData.value.opacity = currentSource.value.sprite.opacity;
    }
    nextTick(() => {
        isSyncing = false;
    });
}

let unsubscribe: any;
watch(() => currentSource.value, () => {
    if (!currentSource.value) {
        return;
    }

    const sprite = currentSource.value.sprite;

    if (unsubscribe) {
        unsubscribe();
    }
    unsubscribe = sprite.on('propsChange', syncCanvasToForm);

    const { rect, opacity } = sprite;
    const { x, y, w, h, angle } = rect;
    formData.value = { x, y, w, h, angle, opacity };
}, { immediate: true });
onBeforeUnmount(() => {
    if (unsubscribe) {
        unsubscribe();
    }
});

function setupWatch(type: 'x' | 'y' | 'w' | 'h' | 'angle' | 'opacity') {
    watch(() => formData.value[type], (next) => {
        if (!currentSource.value) {
            return;
        }
        if (isSyncing) {
            // 保存到历史记录
            throttledPushHistory();
            return;
        }

        if (type === 'opacity') {
            syncSourceMeta(currentSource.value, {
                opacity: next,
            });
        } else {
            syncSourceMeta(currentSource.value, {
                rect: { [type]: next },
            });
        }

        // 保存到历史记录
        throttledPushHistory();
    });
}
;['x', 'y', 'w', 'h', 'angle', 'opacity'].forEach((key) => {
    setupWatch(key as any);
});

async function handleFitSize(type?: 'contain' | 'cover' | 'contain_scale' | 'cover_scale') {
    if (!currentSource.value) {
        return;
    }

    const { clip } = currentSource.value;
    const { meta } = clip as (MP4Clip | ImgClip);
    const { width: imgW, height: imgH } = meta;

    isSyncing = true;
    const rect = autoFitRect({ width: width.value, height: height.value }, { width: imgW, height: imgH }, type);
    Object.assign(formData.value, rect);
    syncSourceMeta(currentSource.value, { rect });
    nextTick(() => {
        isSyncing = false;
    });

    // 保存到历史记录
    await pushHistory();
}

async function handlePutCenter(type: 'x' | 'y') {
    if (!currentSource.value) {
        return;
    }

    isSyncing = true;
    const { sprite } = currentSource.value;
    const { w, h } = sprite.rect;
    const rect = autoFitRect({ width: width.value, height: height.value }, { width: w, height: h });
    formData.value[type] = rect[type];
    sprite.rect[type] = rect[type];
    nextTick(() => {
        isSyncing = false;
    });

    // 保存到历史记录
    await pushHistory();
}
</script>

<template>
    <n-form size="small" label-placement="left" :label-width="48" label-align="right" class="webcut-panel-form">
        <n-alert class="webcut-message" v-if="currentSource?.meta.animation" type="warning">{{ t('当前有动画，调整可能不能直接看到效果，请播放片段查看') }}</n-alert>
        <n-form-item :label="t('位置')" class="n-form-item--flex-column" :feedback="t('视频尺寸为{width}x{height}。', { width, height })">
            <n-input-group>
                <n-input-group-label>X</n-input-group-label>
                <n-input-number v-model:value="formData.x"></n-input-number>
                <n-button secondary @click="handlePutCenter('x')">{{t('居中')}}</n-button>
            </n-input-group>
            <n-input-group>
                <n-input-group-label>Y</n-input-group-label>
                <n-input-number v-model:value="formData.y"></n-input-number>
                <n-button secondary @click="handlePutCenter('y')">{{t('居中')}}</n-button>
            </n-input-group>
        </n-form-item>
        <n-form-item :label="t('尺寸')" class="n-form-item--flex-column" :feedback="currentSource?.type === 'text' ? t('调整文本尺寸可能会改变文本展示效果，建议调整字体大小') : undefined">
            <n-input-group>
                <n-input-group-label>W</n-input-group-label>
                <n-input-number v-model:value="formData.w"></n-input-number>
            </n-input-group>
            <n-input-group>
                <n-input-group-label>H</n-input-group-label>
                <n-input-number v-model:value="formData.h"></n-input-number>
            </n-input-group>
            <n-input-group>
                <n-button size="small" @click="handleFitSize()">{{t('原始尺寸')}}</n-button>
                <n-button size="small" @click="handleFitSize('contain_scale')">{{t('平铺')}}</n-button>
                <n-button size="small" @click="handleFitSize('cover_scale')">{{t('拉伸')}}</n-button>
            </n-input-group>
        </n-form-item>
        <n-form-item :label="t('透明度')" class="n-form-item--flex-row">
            <n-slider v-model:value="formData.opacity" :min="0" :max="1" :step="0.01"></n-slider>
            <n-input-number v-model:value="formData.opacity" :min="0" :max="1" :step="0.01" :precision="2"></n-input-number>
        </n-form-item>
        <n-form-item :label="t('旋转')" class="n-form-item--flex-start">
            <n-input-number v-model:value="formData.angle">
                <template #suffix>rad</template>
            </n-input-number>
            <rotate-input v-model:value="formData.angle" unit="rad"></rotate-input>
        </n-form-item>
    </n-form>
</template>

<style scoped>
.webcut-panel-form {
    padding: 8px;
}
.webcut-message {
  margin-bottom: 8px;
}
</style>