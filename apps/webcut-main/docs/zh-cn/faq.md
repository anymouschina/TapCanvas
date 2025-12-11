# 常见问题（FAQ）

## 时间单位是什么？

大多数 API 使用纳秒（ns）。例如，1 秒 = `1e6`。

## 如何添加素材？

使用 `useWebCutPlayer().push(type, source, meta)`，其中 `type` 为 `video|audio|image|text`。`source` 可以是 `File`、`data:` URL、`file:<id>`（本地 OPFS）或 HTTP URL（见 `src/hooks/index.ts:353`）。

## 如何导出视频或音频？

- `exportBlob()` 返回 MP4 Blob；`download(filename)` 可保存。
- `exportAsWavBlob()` 将当前合成转换为 WAV（见 `src/hooks/index.ts:347`）。

## 时间线轨如何工作？

轨按类型组织；音频轨位于主视频轨下方。片段重叠时会自动创建新轨（见 `src/hooks/index.ts:507`）。

## 如何分割或删除片段？

使用 `useWebCutManager().splitSegment({ segment, rail, keep })` 或 `deleteSegment({ segment, rail })`（见 `src/hooks/manager.ts:181`）。

## 如何持久化与撤销/重做？

`useWebCutHistory()` 集成 `HistoryMachine` 与 IndexedDB + OPFS。调用 `pushHistory(state)`、`undo()`、`redo()`、`clearHistory()`（见 `src/hooks/history.ts:162`）。

## 如何渲染带样式文本？

在推入 `text` 素材时提供 `meta.text.css`，或调用 `updateText(key, { text, css, highlights })`。渲染通过 SVG + foreignObject 生成 `ImageBitmap`（见 `src/libs/index.ts:41`）。