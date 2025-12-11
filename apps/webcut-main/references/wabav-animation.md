# WebAV Animation 实现指南

## 核心概念

### VisibleSprite 类

`VisibleSprite` 是 WebAV 中用于包装 `IClip` 并添加动画属性的核心类，支持坐标、层级、透明度等动画效果。

## 动画实现方法

### setAnimation 方法

使用 `setAnimation` 方法为素材添加关键帧动画，语法类似 CSS 动画：

```typescript
sprite.setAnimation(
  keyFrame: Partial<Record<`${number}%` | "from" | "to", Partial<TAnimateProps>>>,
  opts: IAnimationOpts
): void
```

#### 参数说明

- **keyFrame**: 关键帧配置，包含不同百分比时刻的属性值
  - 支持的属性：`x`、`y`、`scale`、`rotate`、`opacity` 等
  - 支持使用 `from`/`to` 或百分比值定义关键帧

- **opts**: 动画选项
  - `duration`: 动画持续时间（微秒）
  - `delay`: 延迟播放时间（可选）
  - `iterCount`: 播放次数（可选，默认 1）

#### 示例

```typescript
sprite.setAnimation(
  {
    '0%': { x: 0, y: 0 },
    '25%': { x: 1200, y: 680 },
    '50%': { x: 1200, y: 0 },
    '75%': { x: 0, y: 680 },
    '100%': { x: 0, y: 0 },
  },
  { duration: 4e6, iterCount: 1 },
);
```

### TAnimateProps 支持的属性

- `x`: X 坐标
- `y`: Y 坐标
- `scale`: 缩放比例
- `rotate`: 旋转角度（度）
- `opacity`: 透明度（0-1）
- `flip`: 翻转方向（horizontal/vertical/null）

## 完整示例：视频水印动画

```typescript
import {
  Combinator,
  ImgClip,
  MP4Clip,
  OffscreenSprite,
  renderTxt2ImgBitmap,
} from '@webav/av-cliper';

// 创建主视频 sprite
const spr1 = new OffscreenSprite(
  new MP4Clip((await fetch('video/webav1.mp4')).body!),
);
spr1.time.playbackRate = 1;

// 创建水印 sprite
const spr2 = new OffscreenSprite(
  new ImgClip(
    await renderTxt2ImgBitmap(
      '水印',
      `font-size:40px; color: white; text-shadow: 2px 2px 6px red;`,
    ),
  ),
);
spr2.time = { offset: 0, duration: 5e6 }; // 5秒时长

// 设置水印动画：四角循环移动
spr2.setAnimation(
  {
    '0%': { x: 0, y: 0 },
    '25%': { x: 1200, y: 680 },
    '50%': { x: 1200, y: 0 },
    '75%': { x: 0, y: 680 },
    '100%': { x: 0, y: 0 },
  },
  { duration: 4e6, iterCount: 1 }, // 4秒动画，播放1次
);
spr2.zIndex = 10; // 置于顶层
spr2.opacity = 0.5; // 半透明

// 创建组合器并添加 sprites
const com = new Combinator({
  width: 1280,
  height: 720,
  bgColor: 'white',
});

await com.addSprite(spr1, { main: true }); // 主视频
await com.addSprite(spr2); // 水印

// 开始渲染
// com.output() 或其他渲染逻辑
```

## 动画控制方法

### animate 方法

手动将动画属性设置到指定时间点：

```typescript
sprite.animate(time: number): void
```

- **time**: 目标时间（微秒）

## 注意事项

1. 动画时间单位为微秒（1秒 = 1,000,000微秒）
2. 支持循环播放，设置 `iterCount: Infinity` 实现无限循环
3. 可以同时为多个属性添加动画
4. 动画会自动适配素材的播放速率
5. 支持动态修改动画属性，调用 `setAnimation` 会替换现有动画

## 应用场景

- 视频水印移动效果
- 文本淡入淡出
- 图像缩放旋转
- 多元素协同动画
- 动态转场效果