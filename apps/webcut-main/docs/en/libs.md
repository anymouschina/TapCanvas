# Libs

Utilities for text rendering, measurement, auto-fit, exporting, timeline math, and media processing.

## Text Rendering

- `renderTxt2ImgBitmap(text, css, highlights)` → `ImageBitmap` (see `src/libs/index.ts:27`)
- `createTxt2Img(text, css, highlights)` → `HTMLImageElement` (see `src/libs/index.ts:37`)
- `buildTextAsDOM({ text, css, highlights })` → `HTMLElement` (see `src/libs/index.ts:82`)
- `cssToText(css)` → `string` (see `src/libs/index.ts:244`)
- `textToCss(text)` → `Record<string, any>` (see `src/libs/index.ts:272`)

## Measure

- `measureVideoSize(source)` → `{ width, height }` (see `src/libs/index.ts:313`)
- `measureImageSize(source)` → `{ width, height }` (see `src/libs/index.ts:344`)
- `measureVideoDuration(source)` → `ns` (see `src/libs/index.ts:368`)
- `measureAudioDuration(source)` → `ns` (see `src/libs/index.ts:402`)
- `measureTextSize(text, css, highlights)` → `{ height, width }` (see `src/libs/index.ts:437`)

## Auto Fit

- `autoFitRect(canvasSize, elementSize, type)` → `{ w, h, x, y }` (see `src/libs/index.ts:451`)

## Time Formatting

- `formatTime(time)` → `string` (see `src/libs/index.ts:486`)

## File Helpers

- `base64ToFile(base64, filename, mimeType)` → `File` (see `src/libs/file.ts:11`)
- `blobToBase64DataURL(blob)` → `Promise<string>` (see `src/libs/file.ts:29`)
- `fileToBase64DataURL(file)` → `Promise<string>` (see `src/libs/file.ts:45`)
- `downloadBlob(blob, filename)` → `void` (see `src/libs/file.ts:49`)
- `getFileMd5(file)` → `Promise<string>` (see `src/libs/file.ts:63`)
- `blobToFile(blob, fileName)` → `File` (see `src/libs/file.ts:75`)

## Media Processing

- `mp4ClipToBlob(clip)` → `Promise<Blob>` (see `src/libs/index.ts:502`)
- `mp4ClipToFile(clip)` → `Promise<File>` (see `src/libs/index.ts:527`)
- `audioClipToFile(clip)` → `Promise<File>` (see `src/libs/index.ts:533`)
- `pcmToWav(pcmData, sampleRate)` → `Blob` (see `src/libs/index.ts:542`)
- `mp4ClipToFramesData(mp4Clip, options)` → `Promise<{ pcm, frames }>` (see `src/libs/index.ts:729`)
- `progressiveClipToPCMData(clip, progressCallback)` → `Promise<[Float32Array, Float32Array]>` (see `src/libs/index.ts:861`)
- `mp4ClipToAudioClip(mp4Clip)` → `Promise<AudioClip>` (see `src/libs/index.ts:984`)
- `createImageFromVideoFrame(videoFrame, options)` → `Promise<Blob>` (see `src/libs/index.ts:994`)

## Export

- `exportBlobOffscreen(clips, options)` → `Promise<Blob>` (see `src/libs/index.ts:634`)
- `exportAsWavBlobOffscreen(clips)` → `Promise<Blob>` (see `src/libs/index.ts:707`)
- `mp4BlobToWavArrayBuffer(mp4Blob)` → `Promise<ArrayBuffer>` (see `src/libs/index.ts:712`)
- `mp4BlobToWavBlob(mp4Blob)` → `Promise<Blob>` (see `src/libs/index.ts:723`)

## Timeline Math

- `getGridSize(scale)` → `number` (see `src/libs/timeline.ts:2`)
- `getGridPixel(scale, frame)` → `number` (see `src/libs/timeline.ts:28`)
- `getGridFrame(offsetX, scale, frameStep)` → `number` (see `src/libs/timeline.ts:47`)
- `getStep(scale, frameStep)` → `number` (see `src/libs/timeline.ts:59`)
- `getLongText(count, scale)` → `string` (see `src/libs/timeline.ts:64`)
- `getShortText(count, step, scale)` → `string` (see `src/libs/timeline.ts:81`)
- `durationToFrame(duration, fps)` → `number` (see `src/libs/timeline.ts:105`)
- `frameToDuration(frameCount, fps)` → `number` (see `src/libs/timeline.ts:115`)
- `formatTime(time)` → `{ s, m, h, str }` (see `src/libs/timeline.ts:119`)