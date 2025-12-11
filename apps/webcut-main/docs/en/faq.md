# FAQ

## What is the time unit?

Most APIs use nanoseconds for time. For example, 1 second = `1e6`.

## How do I add media?

Use `useWebCutPlayer().push(type, source, meta)` with `type` in `video|audio|image|text`. Sources can be `File`, `data:` URLs, `file:<id>` (local OPFS), or HTTP URLs (see `src/hooks/index.ts:353`).

## How to export video or audio?

- `exportBlob()` returns MP4 Blob; `download(filename)` saves it.
- `exportAsWavBlob()` converts the current composition to WAV (see `src/hooks/index.ts:347`).

## How do timeline rails work?

Rails organize segments by type; audio rails are placed below the main video rail. Overlapping segments auto-create new rails (see `src/hooks/index.ts:507`).

## How to split or delete a segment?

Use `useWebCutManager().splitSegment({ segment, rail, keep })` or `deleteSegment({ segment, rail })` (see `src/hooks/manager.ts:181`).

## How do I persist and undo/redo?

`useWebCutHistory()` integrates with `HistoryMachine` and IndexedDB+OPFS storage. Call `pushHistory(state)`, `undo()`, `redo()`, `clearHistory()` (see `src/hooks/history.ts:162`).

## How to render styled text?

Provide CSS in `meta.text.css` when pushing a `text` clip, or call `updateText(key, { text, css, highlights })`. Rendering uses SVG+foreignObject to produce an `ImageBitmap` (see `src/libs/index.ts:41`).