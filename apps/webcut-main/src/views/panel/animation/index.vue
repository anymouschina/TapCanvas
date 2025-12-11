<script setup lang="ts">
import { ref, watch, computed, nextTick } from 'vue';
import {
    NForm,
    NFormItem,
    NIcon,
    NDivider,
    NInputGroup,
    NInputGroupLabel,
    NRadioGroup,
    NRadioButton,
    NButton,
    NPopover,
    NSlider,
} from 'naive-ui';
import { SubtractAlt } from '@vicons/carbon';
import { useWebCutContext, useWebCutPlayer } from '../../../hooks';
import { useWebCutHistory } from '../../../hooks/history';
import { useT } from '../../../hooks/i18n';
import { fixNum, throttle } from 'ts-fns';
import { WebCutAnimationType, WebCutAnimationData } from '../../../types';
import { animationPresets } from '../../../constants/animation';
import { ScanObject20Filled } from '@vicons/fluent';
import EffectIcon from '../../../components/effect-icon/index.vue';

const { currentSource, currentSegment, cursorTime } = useWebCutContext();
const { applyAnimation } = useWebCutPlayer();
const { push: pushHistory } = useWebCutHistory();
const t = useT();

// 节流保存历史记录
const throttledPushHistory = throttle(pushHistory, 500);

const selectedAnimationType = ref<WebCutAnimationType>(WebCutAnimationType.Enter);

// 当前选中的素材及其配置
const usedAnimation = ref<WebCutAnimationData | null>(null);

// 当前选择的预设选项
const currentPresetOptions = computed(() => {
    const presets = selectedAnimationType.value === WebCutAnimationType.Enter ? animationPresets.filter(p => p.type === WebCutAnimationType.Enter)
        : selectedAnimationType.value === WebCutAnimationType.Exit ? animationPresets.filter(p => p.type === WebCutAnimationType.Exit)
        : animationPresets.filter(p => p.type === WebCutAnimationType.Motion);
    return [
        { key: '', name: t('无') },
        ...presets
    ];
});

const segmentDuration = computed<number>(() => ((currentSegment.value?.end || 0) - (currentSegment.value?.start || 0)));

// 监听当前选中素材变化，加载动画配置
let isSyncing = false;
watch(currentSource, (newSource) => {
    isSyncing = true;

    nextTick(() => {
        isSyncing = false;
    });

    // 如果没有新素材，直接返回
    if (!newSource) {
        return;
    }

    // 从 source.meta 中读取动画配置
    const anim = newSource.meta?.animation;
    if (anim) {
        // 深拷贝确保动画信息独立
        usedAnimation.value = JSON.parse(JSON.stringify(anim));
        selectedAnimationType.value = anim.type;
    }
}, { immediate: true });

watch(usedAnimation, () => {
    if (isSyncing) {
        return;
    }
    onUpdateAnimation();
}, { deep: true });
watch(() => [currentSegment.value?.start, currentSegment.value?.end], () => {
    if (isSyncing) {
        return;
    }
    onUpdateAnimation();
});

function onUpdateAnimation() {
    if (!usedAnimation.value) {
        return;
    }
    applyAnimation(currentSegment.value?.sourceKey!, usedAnimation.value);
    throttledPushHistory();
}

function handleToggleAnimation(presetKey: string) {
    // 删除动画
    if (!presetKey) {
        usedAnimation.value = null;
        applyAnimation(currentSegment.value?.sourceKey!, null);
        pushHistory();
        return;
    }

    const type = selectedAnimationType.value;
    const preset = animationPresets.find(p => p.key === presetKey);
    if (!preset) {
        return;
    }

    const newAnim = {
        type,
        key: presetKey,
    };
    const info = applyAnimation(currentSegment.value?.sourceKey!, newAnim)!;
    isSyncing = true;
    usedAnimation.value = {
        ...newAnim,
        ...info,
    };
    pushHistory();
    nextTick(() => {
        isSyncing = false;
    });
}

function readPresetName(key: string) {
    return t(animationPresets.find(preset => preset.key === key)?.name || '');
}

function handleCaptureTimeAsEnterEnd() {
    if (!usedAnimation.value) {
        return;
    }
    if (!(cursorTime.value > (currentSegment.value?.start || 0) && cursorTime.value < (currentSegment.value?.end || 0))) {
        return;
    }
    usedAnimation.value.duration = cursorTime.value - (currentSegment.value?.start || 0);
}

function handleCaptureTimeAsExitStart() {
    if (!usedAnimation.value) {
        return;
    }
    if (!(cursorTime.value > (currentSegment.value?.start || 0) && cursorTime.value < (currentSegment.value?.end || 0))) {
        return;
    }
    usedAnimation.value.delay = cursorTime.value - (currentSegment.value?.start || 0);
    usedAnimation.value.duration = (currentSegment.value?.end || 0) - cursorTime.value;
}

function calcPercent(dur: number) {
    return dur / segmentDuration.value * 100;
}
function fixedPercent(dur: number) {
    return fixNum(calcPercent(dur), 2);
}
</script>

<template>
    <n-form size="small" label-placement="left" :label-width="60" label-align="right" class="webcut-panel-form webcut-animation-panel">
        <!-- 添加动画按钮 -->
        <div class="webcut-animation-type-section">
            <n-radio-group v-model:value="selectedAnimationType" size="small" class="webcut-animation-type-radio-group">
                <n-radio-button :value="WebCutAnimationType.Enter">
                    <span :class="{ 'webcut-animation-type-radio-button--has-selected': usedAnimation?.type === WebCutAnimationType.Enter }">{{ t('入场') }}</span>
                </n-radio-button>
                <n-radio-button :value="WebCutAnimationType.Exit">
                    <span :class="{ 'webcut-animation-type-radio-button--has-selected': usedAnimation?.type === WebCutAnimationType.Exit }">{{ t('出场') }}</span>
                </n-radio-button>
                <n-radio-button :value="WebCutAnimationType.Motion">
                    <span :class="{ 'webcut-animation-type-radio-button--has-selected': usedAnimation?.type === WebCutAnimationType.Motion }">{{ t('动效') }}</span>
                </n-radio-button>
            </n-radio-group>
        </div>

        <n-divider style="margin: 12px 0;" />

        <section class="webcut-animation-section">
            <div class="webcut-animation-list-section">
                <div
                    v-for="anim in currentPresetOptions"
                    class="webcut-animation-item"
                    :class="{
                        'webcut-animation-item--selected': usedAnimation?.key === anim.key || (!usedAnimation?.type && anim.key === ''),
                    }"
                    :key="anim.key"
                    @click="handleToggleAnimation(anim.key)"
                >
                    <div class="webcut-animation-item-icon webcut-animation-item-icon-none" v-if="!anim.key">
                        <n-icon :component="SubtractAlt" />
                    </div>
                    <effect-icon v-else :name="anim.key" class="webcut-animation-item-icon-bg-box">
                        <div class="webcut-animation-item-icon"></div>
                    </effect-icon>
                    <div class="webcut-animation-item-name">{{ t(anim.name) }}</div>
                </div>
            </div>
            <div class="webcut-animation-form-section" v-if="usedAnimation?.type === selectedAnimationType">
                <n-divider style="margin: 12px 0;" />
                <n-form size="small" label-placement="left" :label-width="60" label-align="right" v-if="usedAnimation?.type === WebCutAnimationType.Enter">
                    <div class="webcut-animation-form-header">{{ readPresetName(usedAnimation?.key) }}</div>
                    <n-form-item :label="t('结束位置')">
                        <n-input-group>
                            <n-slider
                                :value="calcPercent(usedAnimation.duration)"
                                :min="0"
                                :max="100"
                                :tooltip="false"
                                @update:value="(value) => usedAnimation!.duration = Math.round(value / 100 * segmentDuration)"
                            />
                            <n-input-group-label>{{ fixedPercent(usedAnimation.duration) }}%</n-input-group-label>
                            <n-popover>
                                <template #trigger>
                                    <n-button secondary :disabled="!(cursorTime > currentSegment!.start && cursorTime < currentSegment!.end)" @click="handleCaptureTimeAsEnterEnd">
                                        <n-icon size="large" :component="ScanObject20Filled" style="transform: rotate(180deg);"></n-icon>
                                    </n-button>
                                </template>
                                <small>{{ t('使用当前时间轴上的当前时间点') }}</small>
                            </n-popover>
                        </n-input-group>
                    </n-form-item>
                </n-form>
                <n-form size="small" label-placement="left" :label-width="60" label-align="right" v-if="usedAnimation?.type === WebCutAnimationType.Exit">
                    <div class="webcut-animation-form-header">{{ readPresetName(usedAnimation?.key) }}</div>
                    <n-form-item :label="t('开始位置')">
                        <n-input-group>
                            <n-slider
                                :value="calcPercent(usedAnimation.delay || 0)"
                                :min="0"
                                :max="100"
                                :tooltip="false"
                                @update:value="(value) => {
                                    usedAnimation!.delay = Math.round(value / 100 * segmentDuration);
                                    usedAnimation!.duration = (value ? segmentDuration - value : 0);
                                }"
                            />
                            <n-input-group-label>{{ fixedPercent(usedAnimation.delay || 0) }}%</n-input-group-label>
                            <n-popover>
                                <template #trigger>
                                    <n-button secondary :disabled="!(cursorTime > currentSegment!.start && cursorTime < currentSegment!.end)" @click="handleCaptureTimeAsExitStart">
                                        <n-icon size="large" :component="ScanObject20Filled" style="transform: rotate(180deg);"></n-icon>
                                    </n-button>
                                </template>
                                <small>{{ t('使用当前时间轴上的当前时间点') }}</small>
                            </n-popover>
                        </n-input-group>
                    </n-form-item>
                </n-form>
            </div>
        </section>
    </n-form>
</template>

<style scoped>
.webcut-animation-panel {
    display: flex;
    flex-direction: column;
    height: calc(var(--scroll-box-height, 100%) - 16px);
}

.webcut-animation-type-radio-group {
    width: 100%;
    display: flex;
}
.webcut-animation-type-radio-group :deep(.n-radio-button) {
    flex: 1;
}
.webcut-animation-type-radio-group :deep(.n-radio__label) {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
}
.webcut-animation-type-radio-group :deep(.n-radio-button--checked) {
    background-color: var(--webcut-grey-color);
    color: var(--text-color);
}
.webcut-animation-type-radio-button--has-selected {
    color: var(--primary-color);
}
.webcut-animation-section {
    display: contents;
}
.webcut-animation-list-section {
    flex: 1;
    display: flex;
    flex-wrap: wrap;
    flex-shrink: 0;
    flex-basis: 0;
    gap: 12px;
    height: calc(100% - 12px);
    overflow: hidden;
}
.webcut-animation-list-section::after {
    content: '';
    flex: 0 0 auto;
    width: 100%;
    height: 100%;
    pointer-events: none;
}
.webcut-animation-item {
    position: relative;
    width: 42px;
  cursor: default;
}
.webcut-animation-item-icon {
    width: 42px;
    height: 42px;
    border-radius: 6px;
    overflow: hidden;
    box-sizing: border-box;
    border: 1px solid transparent;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    color: var(--text-color-3);
}
.webcut-animation-item-icon-none {
    border: 1px solid var(--border-color);
}
.webcut-animation-item-icon-bg-box {
    width: 42px;
    height: 42px;
    border-radius: 6px;
    overflow: hidden;
}
.webcut-animation-item--selected .webcut-animation-item-icon {
    border-color: var(--primary-color);
    border-width: 2px;
}
.webcut-animation-item-name {
    text-align: center;
    margin-top: 4px;
    font-size: var(--webcut-font-size-tiny);
    max-width: 100%;
    white-space: wrap;
    line-height: 1;
}

.webcut-animation-form-section {
    padding-bottom: 24px;
}
.webcut-animation-form-header {
    margin-bottom: 12px;
}

.webcut-animation-panel :deep(.n-form > .n-form-item:last-of-type .n-form-item-feedback-wrapper:not(:has(*))) {
  display: none;
}
</style>
