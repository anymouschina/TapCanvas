# Hooks

Composable APIs to control canvas, timeline, assets, and history.

## Component Hooks

### useScrollBox

ScrollBox component hook for managing scroll behavior (see `src/components/scroll-box`).

- Manages scroll events and custom scrollbar logic.

## Core Hooks

### useWebCutContext

Provides the reactive project context and selection state (see `src/hooks/index.ts`).

- Fields include `width`, `height`, `canvas`, `clips`, `sprites`, `sources`, `cursorTime`, `status`, `fps`, `scale`, `rails`, `selected`, `current` (see `src/types/index.ts`).
- Call `provide()` once at top-level when using hooks standalone.

### useWebCutPlayer

Core media operations (see `src/hooks/index.ts`).

- `init`, `play`, `pause`, `reset`, `moveTo` — player control
- `push(type, source, meta)` — add media/text with `WebCutMaterialMeta` (see `src/types/index.ts`)
- `remove(key)`, `clear()`, `destroy()` — teardown
- `exportBlob()`, `exportAsWavBlob()` — export MP4/WAV
- `updateText(key, data)` — re-render text as bitmap
- `download(filename)`, `captureImage()`, `resize()`

### useWebCutData

Manages editor data loading, saving, and updates (see `src/hooks/index.ts`).

- Provides data management functionality for project persistence and recovery.

### useWebCutThemeColors

Manages theme colors (see `src/hooks/index.ts`).

- Provides theme color management and custom theme support.

### useWebCutDarkMode

Manages dark mode state (see `src/hooks/index.ts`).

- Handles dark mode switching and state management.

## Manager Hooks

### useWebCutManager

Timeline utilities (see `src/hooks/manager.ts`).

- Cursor: `moveCursorToTime`, `moveCursorToFrame`, `moveCursorToPx`
- Conversions: `timeToPx`, `pxToTime`, `pxOf1Frame`, `timeOf1Frame`
- Segment ops: `resetSegmentTime`, `splitSegment`, `deleteSegment`
- Rails: `toggleRailHidden`, `toggleRailMute`, `resizeManagerMaxHeight`

## Library Hooks

### useWebCutLibrary

Project files from OPFS-backed storage (see `src/hooks/library.ts`).

- `projectFiles`, `files` — computed lists
- `addNewFile(file)`, `removeFile(fileId)`

## Local File Hooks

### useWebCutLocalFile

Resolve blob URLs for locally stored files (see `src/hooks/local-file.ts`).

- `applyFileUrl(fileId)`, `fileUrl(fileId)`, `readFile(fileId)`

## History Hooks

### useWebCutHistory

Persist and restore via `HistoryMachine` (see `src/hooks/history.ts`).

- `pushHistory(state)`, `undo()`, `redo()`, `clearHistory()`
- `canUndo`, `canRedo`, `canRecover`, `recoverProjectState()`

## Internationalization Hooks

### useWebCutLocale

Internationalization language management (see `src/hooks/i18n`).

- Provides language switching and localization support.

## Types

Key types in `src/types/index.ts`:

- `WebCutContext` — editor state
- `WebCutRail`, `WebCutSegment` — timeline data
- `WebCutMaterialMeta` — push options
- `WebCutSource`, `WebCutSourceData` — source mapping and persistence
- `WebCutHighlightOfText` — text highlight type
- `WebCutSegmentOfText` — text segment type
- `WebCutRailOfText` — text rail type
- `WebCutMaterialType` — material type
- `WebCutMaterial` — material type
- `WebCutProjectHistoryState` — project history state
- `WebCutProjectHistoryData` — project history data
- `WebCutColors` — color type