# WebAV Canvas 滤镜效果实现指南

## 一、WebAV 运行原理

WebAV 是基于 WebCodecs API 构建的浏览器端音视频处理 SDK，主要用于在 Web 平台上创建和编辑视频文件。其核心组件包括：

1. **AVCanvas** - 负责音视频渲染和显示，提供了强大的画布功能
2. **VisibleSprite** - 用于包装音视频素材并添加动画属性
3. **各种 Clip** - 如 MP4Clip、ImgClip、AudioClip 等，用于处理不同类型的媒体素材
4. **Combinator** - 用于组合多个素材并生成最终视频

## 二、Canvas 滤镜实现方式

基于 WebAV 实现 Canvas 滤镜效果主要有以下几种方式：

### 1. CSS 滤镜实现（基础方式）

通过直接修改 Canvas 元素的 CSS `filter` 属性实现基础滤镜效果，适用于简单场景：

```javascript
const canvasEl = viewport.querySelector('canvas');
canvasEl.style.filter = `grayscale(50%) blur(2px)`;
```

### 2. WebAV TickInterceptor 滤镜 API（推荐方式）

使用 WebAV 提供的 `clip.tickInterceptor` 接口，支持通过拦截视频帧来实现滤镜效果：

```javascript
const videoClip = new MP4Clip(videoStream);
// 应用滤镜
videoClip.tickInterceptor = async (_, tickRet) => {
  if (tickRet.video) {
    // 对视频帧应用滤镜
    const filteredFrame = applyFilterToVideoFrame(tickRet.video, {
      type: 'grayscale',
      intensity: 0.5
    });
    tickRet.video.close(); // 关闭原始帧
    tickRet.video = filteredFrame; // 使用滤镜处理后的帧
  }
  return tickRet;
};

const sprite = new VisibleSprite(videoClip);
// 添加到画布
canvas.addSprite(sprite);
```

### 3. WebGL 着色器滤镜（高级方式）

对于高级滤镜效果，可以通过自定义 WebGL 着色器实现：

```javascript
const glslFilter = {
  vertexShader: `/* 顶点着色器代码 */`,
  fragmentShader: `/* 片段着色器代码 */`,
  uniforms: {
    u_intensity: 0.5
  }
};

sprite.setFilter(glslFilter);
```

### 4. 帧处理滤镜（逐帧处理）

对于需要逐帧处理的复杂滤镜，可以使用 WebAV 的帧回调机制：

```javascript
canvas.on('frameupdate', (frame) => {
  // 自定义帧处理逻辑
  const processedFrame = applyCustomFilter(frame);
  return processedFrame;
});
```

## 三、核心实现步骤

### 1. 初始化 AVCanvas

```javascript
const canvas = new AVCanvas(viewport, {
  bgColor: '#000',
  width: 800,
  height: 600
});
```

### 2. 创建和配置 VisibleSprite

```javascript
const videoClip = new MP4Clip(videoStream);
const sprite = new VisibleSprite(videoClip);

// 设置基本属性
sprite.rect.w = 800;
sprite.rect.h = 600;
sprite.rect.x = 0;
sprite.rect.y = 0;
```

### 3. 应用滤镜效果

```javascript
// 定义滤镜处理函数
async function applyFilterToVideoFrame(frame: VideoFrame, filterConfig: any): Promise<VideoFrame> {
  // 创建离屏画布用于处理视频帧
  const canvas = new OffscreenCanvas(frame.displayWidth, frame.displayHeight);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法获取画布上下文');

  // 绘制原始帧
  ctx.drawImage(frame, 0, 0);

  // 根据滤镜类型应用不同处理
  switch (filterConfig.type) {
    case 'grayscale':
      // 应用灰度滤镜
      ctx.filter = `grayscale(${filterConfig.intensity * 100}%)`;
      ctx.drawImage(canvas, 0, 0);
      break;
    case 'sepia':
      // 应用复古滤镜
      ctx.filter = `sepia(${filterConfig.intensity * 100}%)`;
      ctx.drawImage(canvas, 0, 0);
      break;
    // 其他滤镜类型...
  }

  // 创建新的视频帧
  return new VideoFrame(canvas, {
    timestamp: frame.timestamp
  });
}

// 应用预设滤镜
videoClip.tickInterceptor = async (_, tickRet) => {
  if (tickRet.video) {
    const filteredFrame = await applyFilterToVideoFrame(tickRet.video, {
      type: 'sepia',
      intensity: 0.7
    });
    tickRet.video.close();
    tickRet.video = filteredFrame;
  }
  return tickRet;
};

// 或者使用 WebGL 着色器处理
videoClip.tickInterceptor = async (_, tickRet) => {
  if (tickRet.video) {
    const filteredFrame = await applyGLSLFilter(tickRet.video, {
      vertexShader: `
        attribute vec2 a_position;
        varying vec2 v_texCoord;
        void main() {
          gl_Position = vec4(a_position, 0.0, 1.0);
          v_texCoord = (a_position + 1.0) / 2.0;
        }
      `,
      fragmentShader: `
        precision mediump float;
        uniform sampler2D u_texture;
        uniform float u_intensity;
        varying vec2 v_texCoord;

        void main() {
          vec4 color = texture2D(u_texture, v_texCoord);
          float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
          vec4 grayColor = vec4(gray, gray, gray, color.a);
          gl_FragColor = mix(color, grayColor, u_intensity);
        }
      `,
      uniforms: {
        u_intensity: 0.5
      }
    });
    tickRet.video.close();
    tickRet.video = filteredFrame;
  }
  return tickRet;
};
```

### 4. 控制滤镜参数

```javascript
// 实时更新滤镜强度
let currentFilterConfig = {
  type: 'grayscale',
  intensity: 0.5
};

function updateFilterIntensity(intensity) {
  currentFilterConfig.intensity = intensity;
}

// 应用更新后的滤镜配置
videoClip.tickInterceptor = async (_, tickRet) => {
  if (tickRet.video) {
    const filteredFrame = await applyFilterToVideoFrame(tickRet.video, currentFilterConfig);
    tickRet.video.close();
    tickRet.video = filteredFrame;
  }
  return tickRet;
};

// 监听滑块变化
slider.addEventListener('input', (e) => {
  updateFilterIntensity(parseFloat(e.target.value));
});
```

## 四、支持的滤镜类型

WebAV 支持多种预设滤镜类型，包括：

| 滤镜类型 | 描述 | 参数范围 |
|---------|------|---------|
| grayscale | 黑白滤镜 | 0.0 - 1.0 |
| sepia | 复古滤镜 | 0.0 - 1.0 |
| blur | 模糊效果 | 0.0 - 10.0 (像素) |
| brightness | 亮度调整 | 0.0 - 2.0 |
| contrast | 对比度调整 | 0.0 - 2.0 |
| hue-rotate | 色相旋转 | 0 - 360 (度) |
| invert | 反色效果 | 0.0 - 1.0 |
| saturate | 饱和度调整 | 0.0 - 3.0 |
| pixelate | 像素化效果 | 0.0 - 1.0 |

## 五、性能优化建议

1. **选择合适的滤镜实现方式**：简单滤镜使用 CSS 或预设滤镜，复杂滤镜使用 WebGL 着色器
2. **避免频繁切换滤镜**：滤镜切换会重新编译着色器，尽量减少切换次数
3. **合理设置滤镜强度**：过高的滤镜强度可能导致性能下降
4. **使用硬件加速**：确保 WebCodecs API 可用，充分利用浏览器硬件加速
5. **优化着色器代码**：简化 GLSL 着色器代码，减少计算复杂度

## 六、示例代码

### Vue 3 示例

```vue
<template>
  <div class="filter-demo">
    <div ref="viewport" class="viewport"></div>
    <div class="controls">
      <button v-for="filter in filters" @click="applyFilter(filter)" :key="filter.name">
        {{ filter.label }}
      </button>
      <input type="range" min="0" max="1" step="0.01" v-model="intensity" @input="updateFilter">
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { AVCanvas } from '@webav/av-canvas';
import { MP4Clip, VisibleSprite } from '@webav/av-cliper';

const viewport = ref();
const canvas = ref<AVCanvas | null>(null);
const sprite = ref<VisibleSprite | null>(null);
const videoClip = ref<any>(null);
const currentFilter = ref('none');
const intensity = ref(0.5);

const filters = [
  { name: 'none', label: '无滤镜' },
  { name: 'grayscale', label: '黑白' },
  { name: 'sepia', label: '复古' },
  { name: 'blur', label: '模糊' }
];

// 定义滤镜处理函数
async function applyFilterToVideoFrame(frame: VideoFrame, filterConfig: any): Promise<VideoFrame> {
  const canvas = new OffscreenCanvas(frame.displayWidth, frame.displayHeight);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法获取画布上下文');

  // 绘制原始帧
  ctx.drawImage(frame, 0, 0);

  // 应用滤镜
  if (filterConfig.type !== 'none') {
    ctx.filter = `${filterConfig.type}(${filterConfig.intensity * 100}%)`;
    ctx.drawImage(canvas, 0, 0);
  }

  // 创建新的视频帧
  return new VideoFrame(canvas, {
    timestamp: frame.timestamp
  });
}

onMounted(async () => {
  // 初始化 AVCanvas
  canvas.value = new AVCanvas(viewport.value!, {
    bgColor: '#000',
    width: 800,
    height: 600
  });

  // 加载视频并创建 Clip
  const response = await fetch('video.mp4');
  videoClip.value = new MP4Clip(response.body!);

  // 创建 Sprite
  sprite.value = new VisibleSprite(videoClip.value);

  // 添加到画布
  await canvas.value.addSprite(sprite.value);

  // 初始应用无滤镜
  updateFilter();
});

function applyFilter(filter: { name: string, label: string }) {
  currentFilter.value = filter.name;
  updateFilter();
}

function updateFilter() {
  if (!videoClip.value) return;

  // 更新 tickInterceptor 实现滤镜效果
  videoClip.value.tickInterceptor = async (_, tickRet) => {
    if (tickRet.video) {
      const filteredFrame = await applyFilterToVideoFrame(tickRet.video, {
        type: currentFilter.value,
        intensity: parseFloat(intensity.value)
      });
      tickRet.video.close(); // 关闭原始帧
      tickRet.video = filteredFrame; // 使用滤镜处理后的帧
    }
    return tickRet;
  };
}
</script>
```

## 七、浏览器兼容性

WebAV 基于 WebCodecs API，需要浏览器支持该 API。目前支持的浏览器包括：

- Chrome 94+
- Edge 94+
- Opera 80+

对于不支持 WebCodecs API 的浏览器，可以使用 WebAV 提供的降级方案或考虑使用其他库。

## 八、总结

基于 WebAV 实现 Canvas 滤镜效果具有以下优势：

1. **高性能** - 基于 WebCodecs API，充分利用浏览器硬件加速
2. **灵活的 API** - 提供多种滤镜实现方式，满足不同场景需求
3. **良好的扩展性** - 支持自定义 WebGL 着色器，实现复杂滤镜效果
4. **易于集成** - 与现有 Web 技术栈兼容，易于集成到各种项目中

通过合理选择滤镜实现方式，并结合 WebAV 提供的强大功能，可以轻松实现高质量的 Canvas 滤镜效果，为用户提供丰富的视觉体验。

## 九、参考资源

- [WebAV 官方文档](https://webav-tech.github.io/WebAV/)
- [WebCodecs API 规范](https://w3c.github.io/webcodecs/)
- [WebGL 着色器编程指南](https://webglfundamentals.org/)
- [Canvas 滤镜效果最佳实践](https://developer.mozilla.org/en-US/docs/Web/CSS/filter)