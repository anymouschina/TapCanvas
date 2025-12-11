# Getting Started

This guide walks through the minimal setup to integrate WebCut in a Vue 3 app and perform core operations: push media, control playback, and export.

## Install & Import

```bash
npm install webcut
```

```ts
// main.ts
import 'webcut/esm/style.css'
```

## Minimal Editor

```vue
<script setup lang="ts">
import { WebCutEditor } from 'webcut'
const projectId = 'getting-started-demo'
</script>

<template>
  <WebCutEditor :project-id="projectId" />
</template>
```

`WebCutEditor` wraps the provider, player, timeline manager, panels and tools in one view, suitable for rapid integration.

## Programmatic Control

Use hooks to push media, control playback, and export.

```ts
import { useWebCutContext, useWebCutPlayer } from 'webcut'

const { provide } = useWebCutContext({ id: 'getting-started-demo' })
provide() // ensure context is provided at app root when using hooks directly

const player = useWebCutPlayer()

// push a video from URL
await player.push('video', 'https://example.com/demo.mp4', {
  autoFitRect: 'contain',
  time: { start: 0, duration: 5e6 }, // 5 seconds in nanoseconds
})

// move and play
player.moveTo(0)
player.play()

// export to Blob (MP4) and download
const blob = await player.exportBlob()
player.download('my-export')
```

- `useWebCutContext` provides reactive state for canvas, rails, sources, and selection (see `src/hooks/index.ts:19`).
- `useWebCutPlayer` exposes media operations: `push`, `play`, `pause`, `moveTo`, `exportBlob`, `exportAsWavBlob`, `download` (see `src/hooks/index.ts:788`).

## Add Text with CSS

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

Text is rendered as an `ImageBitmap` via `renderTxt2ImgBitmap` and inserted as an image clip (see `src/hooks/index.ts:347`, `src/libs/index.ts:27`).

## Timeline Operations

Use `useWebCutManager` for timeline utilities: cursor movement, unit conversions, splitting, muting, and hiding rails.

```ts
import { useWebCutManager } from 'webcut'
const mgr = useWebCutManager()

mgr.moveCursorToFrame(30) // to 1 second at 30 fps
mgr.splitSegment({ segment, rail, keep: 'left' }) // split at cursor
mgr.toggleRailMute(rail)
```

See `src/hooks/manager.ts:9` for available methods.

## Local Files & Library

- Local OPFS storage and project data via `src/db/index.ts` (files, projects, history).
- `useWebCutLibrary` lists project files and adds/removes files (see `src/hooks/library.ts:14`).
- `useWebCutLocalFile` resolves blob URLs for stored files (see `src/hooks/local-file.ts:6`).

## Styles

Import `webcut/esm/style.css` once to include component styles.

## Next Steps

- Explore components and hooks in detail.
- Persist projects and undo/redo with `useWebCutHistory`.
- Use `libs` utilities for measure, auto-fit, and exporting.