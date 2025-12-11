<script setup lang="ts">
import { getStep, getGridSize, getLongText, getShortText } from '../../../libs/timeline';
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch, reactive } from 'vue';
import { useWebCutDarkMode } from '../../../hooks';
import { useWebCutManager } from '../../../hooks/manager';

const emit = defineEmits(['click']);
const props = defineProps<{
  // 选中元素时在时间轴中高亮显示
  focus?: [start: number, end: number];
}>();

const { isDarkMode } = useWebCutDarkMode();
const { cursorPx, fps, scale, moveCursorToPx, scroll2, ruler } = useWebCutManager();

onMounted(() => {
  if (scroll2.value && typeof scroll2.value.onScroll === 'function') {
    scroll2.value.onScroll(updateTimeLine);
  }
});

/**
 * 初始化 Canvas
 * */
let canvasContext = null as any as CanvasRenderingContext2D;
const timeLine = ref();
const canvasConfigs = computed(() => ({
  ratio: window.devicePixelRatio || 1, // 设备像素比
  textSize: 10, // 字号
  textScale: 1, // 支持更小号字： 10 / 12
  lineWidth: 1, // 线宽
  // eslint-disable-next-line
  textBaseline: 'middle', // 文字对齐基线 (ts 中定义的textBaseLine是一个联合类型)
  // eslint-disable-next-line
  longColor: isDarkMode.value ? '#E5E7EB' : '#000', // 长线段颜色
  shortColor: isDarkMode.value ? '#9CA3AF' : '#6B7280', // 短线段颜色
  textColor: isDarkMode.value ? '#E5E7EB' : '#000', // 文字颜色
  subTextColor: isDarkMode.value ? '#9CA3AF' : '#6B7280', // 小文字颜色
  focusColor: isDarkMode.value ? '#6D28D9' : '#C4B5FD', // 选中元素区间
}));
const canvasSize = reactive({
  width: 0,
  height: 20,
});
const canvasStyle = computed(() => {
  return {
    width: `${canvasSize.width}px`,
    height: `${canvasSize.height}px`,
  };
});
const canvasAttr = computed(() => {
  return {
    width: canvasSize.width * canvasConfigs.value.ratio,
    height: canvasSize.height * canvasConfigs.value.ratio,
  };
});

// 设置 canvas 上下文环境
function setCanvasContext() {
  canvasContext = timeLine.value.getContext('2d');
  canvasContext.font = `${canvasConfigs.value.textSize * canvasConfigs.value.ratio}px -apple-system, ".SFNSText-Regular", "SF UI Text", "PingFang SC", "Hiragino Sans GB", "Helvetica Neue", "WenQuanYi Zen Hei", "Microsoft YaHei", Arial, sans-serif`;
  canvasContext.lineWidth = canvasConfigs.value.lineWidth;
  // @ts-ignore
  canvasContext.textBaseline = canvasConfigs.value.textBaseline;
  // @ts-ignore
  if (canvasConfigs.value.textAlign) {
    // @ts-ignore
    canvasContext.textAlign = canvasConfigs.value.textAlign;
  }
}

// 重绘线条
function updateTimeLine() {
  if (!canvasContext || !scroll2.value) {
    return;
  }

  const root = scroll2.value.boxview;
  if (!root) {
    return;
  }

  const { left } = scroll2.value.getScrollOffset();
  const { width } = root.getBoundingClientRect();
  const viewport = {
    scrollLeft: left,
    scrollBoxWidth: width,
  };

  drawRuler(viewport);
}

function drawRuler(viewport: { scrollLeft: number; scrollBoxWidth: number }) {
  if (!canvasContext) {
    return;
  }

  const lineWidth = 0.5; // 线条宽度
  const { scrollLeft } = viewport;

  const step = getStep(scale.value, fps.value);

  const { ratio, textColor, subTextColor, textSize, textScale, focusColor, longColor, shortColor } = canvasConfigs.value;
  const fontSize = textSize * textScale * ratio;
  const { width, height } = canvasSize;

  // 起点向右偏移10像素，以展示完整的cursor
  const from = scrollLeft - 10;

  // 初始化画布
  canvasContext.scale(ratio, ratio);
  canvasContext.clearRect(0, 0, canvasSize.width, canvasSize.height);

  // 1. 时间轴底色
  canvasContext.fillStyle = 'transparent';
  canvasContext.fillRect(0, 0, canvasSize.width, canvasSize.height);

  // 2. 计算网格
  const gridSizeS = getGridSize(scale.value); // 匹配当前缩放下每小格的宽度
  const gridSizeB = gridSizeS * step; // 根据步进计算每大格的宽度

  const startValueS = Math.max(Math.floor(from / gridSizeS) * gridSizeS, 0); // 小格绘制起点的刻度(start 向下取 gridSizeS 的整数倍)
  const startValueB = Math.max(Math.floor(from / gridSizeB) * gridSizeB, 0); // 大格绘制起点的刻度(start 向下取 gridSizeB 的整数倍)

  const offsetXS = (startValueS - from); // 小格起点刻度距离原点(start)的px距离
  const offsetXB = (startValueB - from); // 大格起点刻度距离原点(start)的px距离
  const endValue = from + Math.ceil(width); // 终点刻度(略超出标尺宽度即可)

  // 3. 时间轴聚焦元素
  if (props.focus) {
    let [fStart, fEnd] = props.focus;
    if (fStart < endValue && fEnd > from) {
      let fCount = fEnd - fStart;
      if (scale.value < 70) { // 一个单元格为 1 秒
          fStart = fStart / 30;
          fCount = fCount / 30;
      }
      if (scale.value < 30) { // 一个单元格为 6 秒
          fStart = fStart / 6;
          fCount = fCount / 6;
      }
      const focusS = (fStart * gridSizeS + lineWidth - from); // 选中起点坐标
      const focusW = (fCount * gridSizeS - lineWidth); // 选中宽度
      // if (focusW > gridSizeS) { // 小于一个小格的元素就不提示了
      // }
      canvasContext.fillStyle = focusColor;
      canvasContext.fillRect(focusS, 0, focusW, canvasSize.height * 3 / 8);
    }
  }

  // const textOffsetX = client.isWindows() ? -20 : 0;
  // const textOffsetY = client.isWindows() ? 12 : 0;
  // const clockOffset = client.isWindows() ? 8 : 0;

  /**
   * 长间隔和文字
   *
   * 长间隔和短间隔需分开两次绘制，才可以完成不同颜色的设置；
   * 分开放到两个for循环是为了节省性能，因为如果放到一个for循环的话，每次循环都会重新绘制操作dom
   * */
  canvasContext.beginPath(); // 一定要记得开关路径
  canvasContext.fillStyle = textColor;
  canvasContext.strokeStyle = longColor;
  for (let value = startValueB, count = 0; value < endValue; value += gridSizeB, count++) {
    const x = offsetXB + count * gridSizeB + lineWidth; // prevent canvas 1px line blurry
    const y = height * 5 / 8;

    // 刻度线
    canvasContext.moveTo(x, 0);
    canvasContext.lineTo(x, y);

    // 刻度值
    canvasContext.save();
    canvasContext.scale(textScale / ratio, textScale / ratio);
    const text = getLongText(value / gridSizeB, scale.value);
    const textPositionX = x * ratio + fontSize / 5;
    const textPositionY = y * ratio;
    canvasContext.fillText(text, textPositionX, textPositionY);
    canvasContext.restore();
  }
  canvasContext.stroke();
  canvasContext.closePath();

  /**
   * 短间隔和文字，只在特殊放大倍数下显示文字，
   * 如 1f, 3f...
   */
  canvasContext.beginPath();
  canvasContext.fillStyle = subTextColor;
  canvasContext.strokeStyle = shortColor;
  for (let value = startValueS, count = 0; value < endValue; value += gridSizeS, count++) {
      const x = offsetXS + count * gridSizeS + lineWidth; // prevent canvas 1px line blurry
      const y = height * 3 / 8;

      // 刻度线
      if (value % gridSizeB !== 0) {
          canvasContext.moveTo(x, 0);
          canvasContext.lineTo(x, y);
      }

      // 刻度值
      const text = getShortText(value / gridSizeS, step, scale.value);
      if (text) {
          canvasContext.save();
          canvasContext.scale(textScale / ratio, textScale / ratio);
          const textPositionX = x * ratio + fontSize / 5;
          const textPositionY = y * ratio + fontSize / 2;
          canvasContext.fillText(text, textPositionX, textPositionY);
          canvasContext.restore();
      }
  }
  canvasContext.stroke();
  canvasContext.closePath();

  // 恢复ctx matrix
  canvasContext.setTransform(1, 0, 0, 1, 0, 0);
}

function updateCanvasView() {
  setCanvasContext();
  updateTimeLine();
}

// 设置 canvas 大小
function updateCanvasWidthAndDraw() {
  const root = scroll2.value?.boxview;
  if (!root) {
    return;
  }

  const { width } = root.getBoundingClientRect();
  canvasSize.width = width;

  // 等待canvas元素在DOM中完成属性变更
  nextTick(updateCanvasView);
}

watch(canvasConfigs, updateCanvasView);
watch(props, updateCanvasView);
watch([fps, scale, cursorPx], updateCanvasView);

onMounted(updateCanvasWidthAndDraw);
onMounted(() => {
  window.addEventListener('resize', updateCanvasWidthAndDraw, false);
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', updateCanvasWidthAndDraw);
});

function handleClick(event: MouseEvent) {
  const offsetX = event.offsetX;
  const { left: scrollLeft } = scroll2.value.getScrollOffset();
  const x = Math.max(offsetX + scrollLeft, 0);
  moveCursorToPx(x);
  emit('click');
}

const exports = {
  updateCanvasWidthAndDraw,
};
ruler.value = exports;
</script>

<template>
  <div class="webcut__manager__ruler">
    <canvas :style="canvasStyle" v-bind="canvasAttr" ref="timeLine" @click="handleClick"></canvas>
  </div>
</template>

<style scoped>
.webcut__manager__ruler {
  position: sticky;
  left: 0;
  top: 0;
  z-index: 9000;
}

.webcut__manager__ruler canvas {
  position: fixed;
  left: 0;
  top: 0;
}
</style>
