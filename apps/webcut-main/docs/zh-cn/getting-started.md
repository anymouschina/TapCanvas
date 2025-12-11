# 快速开始

本指南带你在 Vue 3 项目中集成 WebCut，并完成核心操作：推入素材、控制播放、导出。

## 安装与样式

```bash
npm install webcut
```

```ts
// main.ts
import 'webcut/esm/style.css'
```

## 最小编辑器

```vue
<script setup lang="ts">
import { WebCutEditor } from 'webcut'
const projectId = 'getting-started-demo'
</script>

<template>
  <WebCutEditor :project-id="projectId" />
</template>
```

`WebCutEditor` 封装了 Provider、播放器、时间线、面板与工具，适合快速集成。

## 编程式控制

使用钩子推入素材、控制播放与导出。

```ts
import { useWebCutContext, useWebCutPlayer } from 'webcut'

const { provide } = useWebCutContext({ id: 'getting-started-demo' })
provide() // 独立使用钩子时，请在顶层提供上下文

const player = useWebCutPlayer()

// 推入视频（URL）
await player.push('video', 'https://example.com/demo.mp4', {
  autoFitRect: 'contain',
  time: { start: 0, duration: 5e6 },
})

player.moveTo(0)
player.play()

// 导出 MP4 并下载
const blob = await player.exportBlob()
player.download('my-export')
```

- `useWebCutContext` 提供画布、轨道、素材与选中状态（见 `src/hooks/index.ts:19`）。
- `useWebCutPlayer` 暴露 `push`、`play`、`pause`、`moveTo`、`exportBlob` 等方法（见 `src/hooks/index.ts:788`）。

## 添加带样式文本

```ts
await player.push('text', 'Hello WebCut', {
  text: {
    css: {
      'font-size': 48,
      color: '#fff',
      'text-align': 'center',
      '--text-stroke-width': 2,
      '--text-stroke-color': '#000',
    },
  },
  zIndex: 10,
})
```

文本通过 `renderTxt2ImgBitmap` 渲染为 `ImageBitmap`，以图片片段方式加入（见 `src/hooks/index.ts:347`, `src/libs/index.ts:27`）。

## 时间线操作

使用 `useWebCutManager` 进行光标移动、单位转换、分割、静音与隐藏。

```ts
import { useWebCutManager } from 'webcut'
const mgr = useWebCutManager()

mgr.moveCursorToFrame(30) // 1 秒（30 fps）
mgr.splitSegment({ segment, rail, keep: 'left' })
mgr.toggleRailMute(rail)
```

详见 `src/hooks/manager.ts:9`。

## 本地文件与素材库

- 通过 `src/db/index.ts` 使用 IndexedDB + OPFS 管理文件、项目与历史。
- `useWebCutLibrary` 列出项目文件并支持添加/移除（见 `src/hooks/library.ts:14`）。
- `useWebCutLocalFile` 解析本地文件的 blob URL（见 `src/hooks/local-file.ts:6`）。

## 样式

在项目入口引入一次 `webcut/esm/style.css`。

## 下一步

- 查看组件与钩子详情。
- 使用 `useWebCutHistory` 持久化与撤销/重做。
- 使用 `libs` 提供的测量、自动适配与导出工具函数。