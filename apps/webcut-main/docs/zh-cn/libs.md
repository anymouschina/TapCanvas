# 库（Libs）

用于文本渲染、测量、自动适配、导出、时间线计算和媒体处理的工具函数。

## 文本渲染

- `renderTxt2ImgBitmap(text, css, highlights)` → `ImageBitmap`（见 `src/libs/index.ts:27`）
- `createTxt2Img(text, css, highlights)` → `HTMLImageElement`（见 `src/libs/index.ts:37`）
- `buildTextAsDOM({ text, css, highlights })` → `HTMLElement`（见 `src/libs/index.ts:82`）
- `cssToText(css)` → `string`（见 `src/libs/index.ts:244`）
- `textToCss(text)` → `Record<string, any>`（见 `src/libs/index.ts:272`）

## 测量

- `measureVideoSize(source)` → `{ width, height }`（见 `src/libs/index.ts:313`）
- `measureImageSize(source)` → `{ width, height }`（见 `src/libs/index.ts:344`）
- `measureVideoDuration(source)` → `ns`（见 `src/libs/index.ts:368`）
- `measureAudioDuration(source)` → `ns`（见 `src/libs/index.ts:402`）
- `measureTextSize(text, css, highlights)` → `{ height, width }`（见 `src/libs/index.ts:437`）

## 自动适配

- `autoFitRect(canvasSize, elementSize, type)` → `{ w, h, x, y }`（见 `src/libs/index.ts:451`）

## 时间格式化

- `formatTime(time)` → `string`（见 `src/libs/index.ts:486`）

## 文件工具

- `base64ToFile(base64, filename, mimeType)` → `File`（见 `src/libs/file.ts:11`）
- `blobToBase64DataURL(blob)` → `Promise<string>`（见 `src/libs/file.ts:29`）
- `fileToBase64DataURL(file)` → `Promise<string>`（见 `src/libs/file.ts:45`）
- `downloadBlob(blob, filename)` → `void`（见 `src/libs/file.ts:49`）
- `getFileMd5(file)` → `Promise<string>`（见 `src/libs/file.ts:63`）
- `blobToFile(blob, fileName)` → `File`（见 `src/libs/file.ts:75`）

## 媒体处理

- `mp4ClipToBlob(clip)` → `Promise<Blob>`（见 `src/libs/index.ts:502`）
- `mp4ClipToFile(clip)` → `Promise<File>`（见 `src/libs/index.ts:527`）
- `audioClipToFile(clip)` → `Promise<File>`（见 `src/libs/index.ts:533`）
- `pcmToWav(pcmData, sampleRate)` → `Blob`（见 `src/libs/index.ts:542`）
- `mp4ClipToFramesData(mp4Clip, options)` → `Promise<{ pcm, frames }>`（见 `src/libs/index.ts:729`）
- `progressiveClipToPCMData(clip, progressCallback)` → `Promise<[Float32Array, Float32Array]>`（见 `src/libs/index.ts:861`）
- `mp4ClipToAudioClip(mp4Clip)` → `Promise<AudioClip>`（见 `src/libs/index.ts:984`）
- `createImageFromVideoFrame(videoFrame, options)` → `Promise<Blob>`（见 `src/libs/index.ts:994`）

## 导出

- `exportBlobOffscreen(clips, options)` → `Promise<Blob>`（见 `src/libs/index.ts:634`）
- `exportAsWavBlobOffscreen(clips)` → `Promise<Blob>`（见 `src/libs/index.ts:707`）
- `mp4BlobToWavArrayBuffer(mp4Blob)` → `Promise<ArrayBuffer>`（见 `src/libs/index.ts:712`）
- `mp4BlobToWavBlob(mp4Blob)` → `Promise<Blob>`（见 `src/libs/index.ts:723`）

## 时间线计算

- `getGridSize(scale)` → `number`（见 `src/libs/timeline.ts:2`）
- `getGridPixel(scale, frame)` → `number`（见 `src/libs/timeline.ts:28`）
- `getGridFrame(offsetX, scale, frameStep)` → `number`（见 `src/libs/timeline.ts:47`）
- `getStep(scale, frameStep)` → `number`（见 `src/libs/timeline.ts:59`）
- `getLongText(count, scale)` → `string`（见 `src/libs/timeline.ts:64`）
- `getShortText(count, step, scale)` → `string`（见 `src/libs/timeline.ts:81`）
- `durationToFrame(duration, fps)` → `number`（见 `src/libs/timeline.ts:105`）
- `frameToDuration(frameCount, fps)` → `number`（见 `src/libs/timeline.ts:115`）
- `formatTime(time)` → `{ s, m, h, str }`（见 `src/libs/timeline.ts:119`）