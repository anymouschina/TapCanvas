
<script setup lang="ts">
import { useWebCutLoading } from '../../hooks';
import { NSpin } from 'naive-ui';

const { loading } = useWebCutLoading();

const props = defineProps<{
  size?: number | string;
}>();
</script>

<template>
  <n-spin class="webcut-loading-spinner" :style="{ '--webcut-loading-size': size && typeof size === 'number' ? size + 'px' : props.size }" size="small" v-if="loading"></n-spin>
</template>

<style scoped>
.webcut-loading-spinner :deep(.n-spin) {
  --n-size: var(--webcut-loading-size, 1em) !important;
}
.webcut-loading-spinner :deep(.n-base-loading .n-base-loading__container .n-base-loading__icon) {
  width: 100%;
  height: 100%;
}
</style>