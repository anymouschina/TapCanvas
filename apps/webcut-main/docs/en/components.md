# Components

Key exported components for building your editor UI.

## Core Views

- `WebCutEditor` — all-in-one editor container (`src/views/editor/index.vue`).
- `WebCutProvider` — provides context to child components (`src/views/provider/index.vue`).
- `WebCutPlayer`, `WebCutPlayerScreen`, `WebCutPlayerButton` — player views (`src/views/player/*`).
- `WebCutManager` — timeline manager (`src/views/manager/index.vue`).
- `WebCutManagerContainer` — timeline container (`src/views/manager/container/index.vue`).
- `WebCutManagerScaler` — timeline scaler (`src/views/manager/scaler/index.vue`).
- `WebCutManagerAsideRail` — timeline aside rail (`src/views/manager/aside/index.vue`).
- `WebCutManagerMainSegment` — timeline main segment area (`src/views/manager/main/index.vue`).
- `WebCutManagerToolBar` — timeline toolbar (`src/views/manager/tool-bar/index.vue`).
- `WebCutLibrary` — asset library (audio, image, text, video) (`src/views/library/*`).
- `WebCutPanel`, `WebCutBasicPanel`, `WebCutTextPanel` — edit panels (`src/views/panel/*`).
- `WebCutSelectAspectRatio` — canvas aspect ratio selector (`src/views/select-aspect-ratio/index.vue`).
- `WebCutTimeClock` — time display (`src/views/time-clock/index.vue`).
- `WebCutThemeSwitch` — dark mode toggle (`src/views/theme-switch/index.vue`).
- `WebCutExportButton` — export button (`src/views/export-button/index.vue`).
- `WebCutLangSwitch` — language switcher (`src/views/lang-switch/index.vue`).

## Segments

- `WebCutVideoSegment` — video segment (`src/views/manager/segments/video.vue`).
- `WebCutAudioSegment` — audio segment (`src/views/manager/segments/audio.vue`).
- `WebCutImageSegment` — image segment (`src/views/manager/segments/image.vue`).
- `WebCutTextSegment` — text segment (`src/views/manager/segments/text.vue`).

## Tools

- `WebCutClearTool` — clear timeline tool (`src/views/tools/clear/index.vue`).
- `WebCutDeleteTool` — delete segment tool (`src/views/tools/delete/index.vue`).
- `WebCutSplitTool` — split segment tool (`src/views/tools/split/index.vue`).
- `WebCutSplitKeepLeftTool` — split and keep left segment tool (`src/views/tools/split-keep-left/index.vue`).
- `WebCutSplitKeepRightTool` — split and keep right segment tool (`src/views/tools/split-keep-right/index.vue`).
- `WebCutFlipHorizontalTool` — flip horizontal tool (`src/views/tools/flip-h/index.vue`).
- `WebCutConcatTool` — concatenate segments tool (`src/views/tools/concat/index.vue`).

All tools live under `src/views/tools/*` and operate on the current segment and cursor.

## Base Components

- `AdjustableBox` — adjustable size container (`src/components/adjustable-box/index.vue`).
- `AudioShape` — audio waveform visualization (`src/components/audio-shape/index.vue`).
- `ContextMenu` — context menu component (`src/components/context-menu/index.vue`).
- `ScrollBox` — custom scroll container (`src/components/scroll-box/index.vue`).
- `DraggableHandler` — draggable handler component (`src/components/draggable-handler/index.vue`).
- `RotateInput` — rotate input component (`src/components/rotate-input/index.vue`).

## Usage

```vue
<script setup lang="ts">
import { WebCutProvider, WebCutEditor, WebCutThemeSwitch } from 'webcut'
</script>

<template>
  <WebCutProvider>
    <WebCutThemeSwitch />
    <WebCutEditor :project-id="'project-1'" />
  </WebCutProvider>
</template>
```

See exports in `src/index.ts`.