<script setup lang="ts">
import { ref, h, computed, watch } from 'vue';
import { NDropdown, NButton, NIcon } from 'naive-ui';
import {
    Tablet20Regular,
    Tablet32Regular,
    Phone16Regular,
    Phone24Regular,
    Square16Regular,
    PhoneDesktop28Regular,
} from '@vicons/fluent';
import { useWebCutContext } from '../../hooks';
import { aspectRatioMap } from '../../constants';

const props = defineProps<{
  /** 是否展示比例文字 */
  displayAspect?: boolean;
}>();

const { width, height, updateByAspectRatio, calcByAspectRatio } = useWebCutContext();

// 长宽比状态
const aspectRatio = ref('4:3');
// 定义长宽比选项
const AspectRatioOptions = computed(() => [
  {
    label: '21:9',
    key: '21:9',
    icon: () => h(NIcon, null, { default: () => h(Tablet20Regular) }),
    disabled: aspectRatio.value === '21:9',
  },
  {
    label: '16:9',
    key: '16:9',
    icon: () => h(NIcon, null, { default: () => h(Tablet20Regular) }),
    disabled: aspectRatio.value === '16:9',
  },
  {
    label: '4:3',
    key: '4:3',
    icon: () => h(NIcon, null, { default: () => h(Tablet32Regular) }),
    disabled: aspectRatio.value === '4:3',
  },
  {
    label: '9:16',
    key: '9:16',
    icon: () => h(NIcon, null, { default: () => h(Phone16Regular) }),
    disabled: aspectRatio.value === '9:16',
  },
  {
    label: '3:4',
    key: '3:4',
    icon: () => h(NIcon, null, { default: () => h(Phone24Regular) }),
    disabled: aspectRatio.value === '3:4',
  },
  {
    label: '1:1',
    key: '1:1',
    icon: () => h(NIcon, null, { default: () => h(Square16Regular) }),
    disabled: aspectRatio.value === '1:1',
  },
]);

watch([width, height], ([width, height]) => {
  const closestRatio = calcByAspectRatio(width, height);
  aspectRatio.value = closestRatio;
}, { immediate: true });

// 处理长宽比选择
async function handleSelectAspectRatio(value: keyof typeof aspectRatioMap) {
  aspectRatio.value = value;
  await updateByAspectRatio(value);
}
</script>

<template>
    <NDropdown trigger="click" placement="top-end" size="small" :options="AspectRatioOptions" @select="handleSelectAspectRatio">
        <NButton text :focusable="false" size="tiny">
            <template #icon>
                <NIcon>
                <PhoneDesktop28Regular />
                </NIcon>
            </template>
            <span v-if="props.displayAspect">{{ aspectRatio }}</span>
        </NButton>
    </NDropdown>
</template>
