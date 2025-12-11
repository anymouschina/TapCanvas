
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WebCut is a web-based video editing UI framework built with Vue 3 and TypeScript. It provides a canvas-based video editor with timeline controls, supporting video, audio, image, and text materials. The project leverages @webav/av-canvas and @webav/av-cliper for video rendering and editing capabilities.

## Development Commands

### Build Commands
```bash
# Build all outputs (ESM + WebComponents)
pnpm build

# Build ESM library only (outputs to esm/)
pnpm run build:esm

# Build WebComponents only (outputs to webcomponents/)
pnpm run build:webcomponents

# Build WebComponents bundle (outputs to webcomponents/bundle/)
pnpm run build:webcomponents_bundle
```

### Development
```bash
# Start development server
pnpm dev

# Run tests
pnpm test

# Run tests with coverage
pnpm test:coverage

# Lint and fix code
pnpm lint

# Type checking
pnpm typecheck

# Serve documentation locally
pnpm docs
```

### Release
```bash
# Create a new version with changelog
pnpm release
```

## Architecture

### Dual Build System

The project produces two distinct outputs:

1. **ESM Build** (`src/index.ts` → `esm/`): Standard ES module library for Vue 3 applications. Exports Vue components, composables, utility functions, and TypeScript types.

2. **WebComponents Build** (`src/webcomponents.ts` → `webcomponents/`): Custom elements using Vue's `defineCustomElement`. All components are registered as web components (e.g., `<webcut-editor>`, `<webcut-player>`).

### Core Architecture Pattern

WebCut uses a **context-based architecture** where state flows through Vue's provide/inject system:

- **Context Layer** (`src/hooks/index.ts`): `useWebCutContext()` creates a reactive context object that holds the entire editor state (canvas, sprites, clips, rails, sources, cursor position, playback status, etc.). This context is provided to all child components.

- **Player Layer** (`useWebCutPlayer()`): Manages AVCanvas instance, playback controls, and material operations (push/remove/update). Handles the lifecycle of clips and sprites.

- **Manager Layer** (`src/hooks/manager.ts`): Controls the timeline UI, segment manipulation, and rail management.

- **Library Layer** (`src/hooks/library.ts`): Manages the material library and file uploads.

### Key Data Structures

**Rails and Segments**: The timeline is organized into rails (tracks), each containing segments (material instances):
- `WebCutRail`: Represents a track (video/audio/image/text type)
- `WebCutSegment`: Represents a material instance on the timeline with start/end times
- Rails are stored in `context.rails[]`

**Sources Map**: A Map that links segment IDs to their underlying resources:
- Key: Random string ID
- Value: `WebCutSource` containing clip, sprite, metadata, fileId, railId, segmentId
- Stored in `context.sources`

**Clips and Sprites**:
- Clips (MP4Clip, ImgClip, AudioClip) from @webav/av-cliper handle media decoding
- Sprites (VisibleSprite) from @webav/av-cliper represent renderable objects on the canvas
- Both are stored as markRaw() to prevent Vue reactivity overhead

### State Management

The project uses **Vue Composition API** with provide/inject, not Pinia or Vuex:

1. `useWebCutContext()` creates and provides the root context
2. Child components inject the context via the same composable
3. All state mutations happen through composable methods
4. History/undo is managed via `src/hooks/history.ts` and persisted to IndexedDB

### Storage Layer (`src/db/index.ts`)

Uses IndexedDB (via InDB library) and OPFS (Origin Private File System) for persistence:

- **IndexedDB stores**: `file` (metadata), `project`, `history`, `project_state`
- **OPFS**: Actual file contents stored at `/webcut/file/{fileId}`
- Files are identified by MD5 hash to enable deduplication
- Project state (rails, sources) is persisted and restored on load

### Component Organization

- `src/views/`: High-level feature components (editor, player, manager, panel, library, tools)
- `src/components/`: Reusable UI components (adjustable-box, audio-shape, context-menu, etc.)
- `src/hooks/`: Composables for business logic
- `src/libs/`: Pure utility functions (file operations, canvas utilities, timeline calculations)
- `src/types/`: TypeScript type definitions

### Material Workflow

Adding a material (video/audio/image/text):
1. `useWebCutPlayer().push()` is called with type and source
2. Creates a Clip from the source (file/URL/base64)
3. Wraps Clip in a VisibleSprite with positioning/timing
4. Adds Sprite to AVCanvas for rendering
5. Creates a Segment and adds to appropriate Rail
6. Stores mapping in Sources Map
7. Persists to IndexedDB if part of a project

### Text Material Handling

Text is converted to images for rendering:
- `renderTxt2ImgBitmap()` in `src/libs/index.ts` converts text+CSS to ImageBitmap
- Text can have highlights (different colors for text ranges)
- CSS properties control appearance, positioning uses margin/padding
- Updates require regenerating the bitmap and replacing the sprite

### Animation System (`src/constants/animation.ts`)

- Predefined animation presets for enter, exit, and motion effects
- Applied to sprites via `useWebCutPlayer().applyAnimation()`
- Animation types: Enter, Exit, Motion
- Uses keyframe-based system with duration, delay, and iteration count

### History System (`src/hooks/history.ts`)

- Undo/redo functionality with state persistence to IndexedDB
- Snapshots of rails and sources state are stored
- Uses HistoryMachine to manage history stack
- Recover feature to restore previous project state

### Internationalization

Locales in `src/locales/` (zh-HK, zh-TW, en-US, ja-JP, de-DE, es-ES, fr-FR). The `useWebCutLocale()` hook manages language switching.

## Important Notes

- **Performance**: Clips and Sprites are wrapped in `markRaw()` to prevent Vue reactivity, which would cause severe performance issues with video data.

- **Time Units**: All time values are in **microseconds** (1 second = 1,000,000 microseconds). This is the unit used by @webav/av-cliper.

- **Canvas Lifecycle**: The AVCanvas instance must be properly destroyed when unmounting to prevent memory leaks. Use `useWebCutPlayer().destroy()`.

- **File Storage**: Files are stored in OPFS and referenced by MD5 hash. The same file uploaded multiple times will only be stored once.

- **History System**: Undo/redo is implemented via snapshots of rails and sources state, stored in IndexedDB. The `historyAt` pointer tracks the current position in history.

- **Sprite Selection**: When `context.disableSelectSprite` is true, clicking sprites on the canvas won't select them. This is used during certain editing operations.

- **Rail Auto-assignment**: When pushing materials without specifying a rail, the system automatically finds or creates an appropriate rail, avoiding overlapping segments.

## Testing

The project uses Vitest for testing. No specific test files were found in the current codebase, but the infrastructure is in place (vitest.config.ts).

## Documentation

Comprehensive documentation is available in the `docs/` directory with support for both English and Chinese:
- API documentation
- Component documentation
- Hooks documentation
- Getting started guides
- WebComponents documentation
