<script setup lang="ts">
import { computed } from 'vue';
import EffectSprite from '../../img/effect-icons.jpg';

// 支持的图标尺寸类型
type IconSize = 16 | 24 | 32 | 48 | 64;

// 图标名称列表（基于图片中的文字）
const iconNames = [
  'fadeIn', 'slideInLeft', 'slideInRight', 'slideInTop', 'slideInBottom', 'zoomIn', 'rotateIn', 'fadeOut',
  'slideOutLeft', 'slideOutRight', 'slideOutTop', 'slideOutBottom', 'zoomOut', 'rotateOut', 'pulse', 'shake',
  'bounce', 'swing', 'flash', 'grayscale', 'blur', 'brightness', 'contrast', 'saturate',
  'glow', 'shadow', 'neon', 'gradient', 'crop', 'cropToCircle', 'pixelate', 'blankIcon'
];

// 组件属性
const props = defineProps<{
  /**
   * 图标名称
   */
  name: string;
  /**
   * 图标尺寸
   */
  size?: IconSize;
}>();

// 默认图标尺寸
const defaultSize: IconSize = 48;

// 雪碧图的实际尺寸和布局信息
const spriteOriginalWidth = 1024;
const spriteOriginalHeight = 565;
const originalIconSize = 90; // 雪碧图中每个图标的实际像素尺寸
const iconsPerRow = 8;
// 原始图标在雪碧图中每一行的顶部位置，后面用于y的计算
const originalTopPositions = [13, 150, 321, 457];
// 原始图标在雪碧图中每一行的左侧位置，后面用于x的计算
const originalLeftPositions = [19, 148, 276, 403, 532, 660, 788, 916];

// 计算实际使用的图标尺寸
const iconSize = computed(() => props.size || defaultSize);
// 缩放比例
const scale = computed(() => iconSize.value / originalIconSize);

// 计算图标索引
const iconIndex = computed(() => {
  const index = iconNames.indexOf(props.name);
  return index >= 0 ? index : 31; // 默认使用最后一个空白图标
});

// 计算缩放后的雪碧图尺寸（基于图标真实尺寸）
const spriteSize = computed(() => {
  return {
    width: spriteOriginalWidth * scale.value,
    height: spriteOriginalHeight * scale.value
  };
});

// 计算图标在雪碧图中的位置
const iconPosition = computed(() => {
  const row = Math.floor(iconIndex.value / iconsPerRow);
  const col = iconIndex.value % iconsPerRow;

  const top = -originalTopPositions[row] * scale.value;
  const left = -originalLeftPositions[col] * scale.value;

  return { x: left, y: top };
});

// 计算图标样式
const iconStyle = computed(() => {
  return {
    backgroundImage: `url(${EffectSprite})`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: `${iconPosition.value.x}px ${iconPosition.value.y}px`,
    backgroundSize: `${spriteSize.value.width}px ${spriteSize.value.height}px`
  };
});
</script>

<template>
  <div class="webcut-effect-icon" :style="iconStyle">
    <slot></slot>
  </div>
</template>

<style scoped>
.webcut-effect-icon {
  display: inline-block;
  vertical-align: middle;
}
</style>