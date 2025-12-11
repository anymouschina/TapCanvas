# 钩子（Hooks）

用于控制画布、时间线、素材与历史的组合式 API。

## 组件钩子

### useScrollBox

ScrollBox 组件的钩子，管理滚动行为（见 `src/components/scroll-box`）。

- 处理滚动事件，实现自定义滚动条和滚动逻辑。

## 核心钩子

### useWebCutContext

提供项目上下文与选中状态（见 `src/hooks/index.ts`）。

- 字段包括 `width`、`height`、`canvas`、`clips`、`sprites`、`sources`、`cursorTime`、`status`、`fps`、`scale`、`rails`、`selected`、`current`（见 `src/types/index.ts`）
- 独立使用钩子时，在顶层调用 `provide()` 提供上下文

### useWebCutPlayer

核心媒体操作（见 `src/hooks/index.ts`）。

- 播放控制：`init`、`play`、`pause`、`reset`、`moveTo`
- 推入素材：`push(type, source, meta)`，`WebCutMaterialMeta` 定义见 `src/types/index.ts`
- 清理与销毁：`remove(key)`、`clear()`、`destroy()`
- 导出：`exportBlob()`、`exportAsWavBlob()`、`download(filename)`
- 文本更新：`updateText(key, data)` 重新渲染文本为位图
- 其他：`captureImage()`、`resize()`

### useWebCutData

管理编辑器数据的加载、保存和更新（见 `src/hooks/index.ts`）。

- 提供数据管理功能，支持项目数据的持久化和恢复。

### useWebCutThemeColors

管理主题颜色（见 `src/hooks/index.ts`）。

- 提供主题颜色的获取和管理功能，支持自定义主题。

### useWebCutDarkMode

管理暗色模式状态（见 `src/hooks/index.ts`）。

- 处理暗色模式的切换和状态管理。

## 管理器钩子

### useWebCutManager

时间线工具（见 `src/hooks/manager.ts`）。

- 光标：`moveCursorToTime`、`moveCursorToFrame`、`moveCursorToPx`
- 转换：`timeToPx`、`pxToTime`、`pxOf1Frame`、`timeOf1Frame`
- 片段：`resetSegmentTime`、`splitSegment`、`deleteSegment`
- 轨：`toggleRailHidden`、`toggleRailMute`、`resizeManagerMaxHeight`

## 素材库钩子

### useWebCutLibrary

项目文件管理（见 `src/hooks/library.ts`）。

- `projectFiles`、`files` 列表
- `addNewFile(file)`、`removeFile(fileId)`

## 本地文件钩子

### useWebCutLocalFile

解析本地文件 URL（见 `src/hooks/local-file.ts`）。

- `applyFileUrl(fileId)`、`fileUrl(fileId)`、`readFile(fileId)`

## 历史钩子

### useWebCutHistory

通过 `HistoryMachine` 持久化并恢复（见 `src/hooks/history.ts`）。

- `pushHistory(state)`、`undo()`、`redo()`、`clearHistory()`
- `canUndo`、`canRedo`、`canRecover`、`recoverProjectState()`

## 国际化钩子

### useWebCutLocale

国际化语言管理（见 `src/hooks/i18n`）。

- 提供语言切换和本地化支持。

## 类型

`src/types/index.ts` 中的关键类型：

- `WebCutContext` — 编辑器状态
- `WebCutRail`、`WebCutSegment` — 时间线数据
- `WebCutMaterialMeta` — 推入素材选项
- `WebCutSource`、`WebCutSourceData` — 素材映射与持久化
- `WebCutHighlightOfText` — 文本高亮类型
- `WebCutSegmentOfText` — 文本片段类型
- `WebCutRailOfText` — 文本轨道类型
- `WebCutMaterialType` — 素材类型
- `WebCutMaterial` — 素材类型
- `WebCutProjectHistoryState` — 项目历史状态
- `WebCutProjectHistoryData` — 项目历史数据
- `WebCutColors` — 颜色类型