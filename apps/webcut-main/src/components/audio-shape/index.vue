<script setup lang="ts">
import { isEqual, throttle } from 'ts-fns';
import { ref, watch, nextTick, computed } from 'vue';
import { AudioClip, MP4Clip } from '@webav/av-cliper';
import { useWebCutLocalFile } from '../../hooks/local-file';
import { progressiveClipToPCMData } from '../../libs';

// 使用local-file hook
const { readFile } = useWebCutLocalFile();

// Web Audio API解码
async function decodeAudioFile(file: Blob): Promise<Float32Array | null> {
  try {
    const context = new AudioContext();
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await context.decodeAudioData(arrayBuffer);
    return audioBuffer.getChannelData(0);
  } catch (error) {
    console.error('Web Audio API decode error:', error);
    return null;
  }
}

// 从AudioClip或MP4Clip中渐进式提取PCM数据
async function extractFromClip(clip: AudioClip | MP4Clip): Promise<Float32Array | null> {
  try {
    // 创建一个引用用于在回调中更新数据
    const pcmResultRef = { left: null as Float32Array | null, right: null as Float32Array | null };

    // 使用渐进式PCM提取函数
    await progressiveClipToPCMData(clip, (pcm: [Float32Array, Float32Array]) => {
      const [left, right] = pcm;

      // 立即更新内部数据，实现渐进式显示
      if (left) {
        internalData.value = left;
      } else if (right) {
        internalData.value = right;
      }

      // 保存完整结果
      pcmResultRef.left = left;
      pcmResultRef.right = right;
    });

    // 返回完整的PCM数据
    return pcmResultRef.left || pcmResultRef.right || null;
  } catch (error) {
    console.error('Extract from clip error:', error);
    return null;
  }
}

// 支持多类型的输入数据
const props = defineProps<{
    height: number;
    width: number;
    data: Float32Array | Blob | AudioClip | MP4Clip | string | null; // 支持浮点数数组、文件、clip、fileId
    visibleRange?: [left: number, right: number];
}>();

// 内部存储解码后的PCM数据
const internalData = ref<Float32Array | null>(null);

const container = ref();
const canvas = ref();
const canvasWidth = computed(() => {
    if (props.visibleRange) {
        const [start, end] = props.visibleRange;
        const rangeWidth = end - start;
        return rangeWidth > props.width ? props.width : rangeWidth;
    }
    return props.width;
});
const canvasLeft = computed(() => {
    if (props.visibleRange) {
        const [start] = props.visibleRange;
        return start;
    }
    return 0;
});

// 监听数据变化，自动解码
watch(() => props.data, async (newData) => {
  if (!newData) {
    internalData.value = null;
    return;
  }

  // Float32Array直接使用
  if (newData instanceof Float32Array) {
    internalData.value = newData;
    return;
  }

  // Blob文件解码
  if (newData instanceof Blob) {
    internalData.value = await decodeAudioFile(newData);
    return;
  }

  // AudioClip或MP4Clip提取
  if (newData instanceof AudioClip || newData instanceof MP4Clip) {
    internalData.value = await extractFromClip(newData);
    return;
  }

  // string作为fileId读取并解码
  if (typeof newData === 'string') {
    const audioBlob = await readFile(newData);
    if (audioBlob) {
      internalData.value = await decodeAudioFile(audioBlob);
    }
    return;
  }
}, { immediate: true });

async function drawWave() {
    if (!internalData.value || !canvas.value || !props.width || !props.height) {
        return;
    }

    const visibleRange = props.visibleRange;
    const visibleStart = visibleRange ? visibleRange[0] : 0;
    const visibleEnd = visibleRange ? visibleRange[1] : props.width;

    const audioFloatArray = internalData.value;
    const audioBufferLength = audioFloatArray.length;

    const canvasContext = canvas.value.getContext('2d');
    const canvasWidth = canvas.value.width;
    const canvasHeight = canvas.value.height;

    canvasContext.clearRect(0, 0, canvasWidth, canvasHeight);

    const step = Math.floor(audioBufferLength / props.width);
    const maxHeight = canvas.value.height;

    canvasContext.beginPath();

    for (let i = visibleStart; i <= visibleEnd; i++) {
        const index = i * step;
        const value = audioFloatArray[index] * maxHeight;
        const x = i;
        const y = canvasHeight / 2 + value;
        if (i === visibleStart) {
            canvasContext.moveTo(x - visibleStart, y);
        }
        else {
            canvasContext.lineTo(x - visibleStart, y);
        }
    }

    canvasContext.strokeStyle = 'white';
    canvasContext.lineWidth = 1;
    canvasContext.stroke();
}

watch(() => [props.width, props.height, internalData.value], () => {
    if (!props.width || !props.height || !internalData.value) {
        return;
    }

    nextTick(() => {
        drawWave();
    });
}, { immediate: true });

const redraw = throttle((next, prev) => {
    if (next && !isEqual(next, prev)) {
        drawWave();
    }
}, 16);
watch(() => props.visibleRange, redraw);

defineExpose({
  container,
  canvas,
});
</script>

<template>
    <div class="audio-shape-container" :style="{ width: props.width + 'px', height: props.height + 'px' }" ref="container">
        <canvas class="audio-shape-canvas" ref="canvas" :height="props.height" :width="canvasWidth" :style="{ left: canvasLeft + 'px' }"></canvas>
    </div>
</template>

<style scoped lang="less">
.audio-shape-container {
    position: relative;
}
.audio-shape-canvas {
    position: absolute;
    left: 0;
    top: 0;
    display: block;
    line-height: 1;
}
</style>