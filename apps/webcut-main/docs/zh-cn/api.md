# API参考

本参考对 `src/index.ts` 的所有导出做深入说明，覆盖职责、入参、返回值、事件与内部行为，并附源码位置便于跳转。

## 组件

### 核心组件

#### WebCutProvider
- 功能：提供全局 `WebCutContext`，包裹 Naive UI 的主题与语言 Provider。
- 入参：`{ data?: Partial<WebCutContext> }`（`src/views/provider/index.vue:22`），传入时与默认值合并并注入上下文（`src/hooks/index.ts:20–49`）。
- 行为：
  - 初始化暗/亮主题覆盖（`src/views/provider/index.vue:37–101`），基于 `navigator.language` 设置 `locale`（`src/views/provider/index.vue:103–119`）。
  - 提供 `WEBCUT_CONTEXT` 以便子组件/钩子消费（`src/views/provider/index.vue:126`，`src/hooks/index.ts:95`）。
- 插槽：默认插槽承载编辑器 UI。

#### WebCutEditor
- 功能：一体化编辑器视图，组合素材库、播放器、控制区、面板与时间线。
- 入参：`{ projectId?: string }`（`src/views/editor/index.vue:30`），通过 `useWebCutContext` 将 `id` 写入上下文（`src/views/editor/index.vue:34–37`）。
- 行为：
  - 根据布局计算并设置时间线最大高度（`src/views/editor/index.vue:42–46`）。
  - 导出按钮调用 `useWebCutPlayer.download`（`src/views/editor/index.vue:87–93`）。

#### WebCutPlayer
- 功能：编辑器内部播放器容器，组合 PlayerScreen 与 PlayerButton。
- 结构：封装播放器屏幕和控制按钮，提供完整的媒体播放控制界面。

### 播放器组件

#### WebCutPlayerScreen
- 功能：承载 `AVCanvas` 的视口，并暴露精简播放器 API 与事件总线。
- 入参：`{ maxWidth?: number; maxHeight?: number }`（`src/views/player/screen.vue:6–11`）。
- 暴露：`player.value = { fitBoxSize, on, off, once, emit }`（`src/views/player/screen.vue:73–81`）。可监听 `timeupdate`、`playing`、`paused`、`active`、`change` 等（`src/hooks/index.ts:246–296`）。
- 行为：按容器与可选最大值缩放；窗口尺寸变化自适应（`src/views/player/screen.vue:30–66`）。

#### WebCutPlayerButton
- 功能：播放控制；可选前后跳转。
- 入参：`{ displaySkipButtons?: boolean }`（`src/views/player/button.vue:6–8`）。
- 行为：将 `status` −1/0/1 映射到图标与动作（`src/views/player/button.vue:13–22`）；前跳到 `duration - fps`（`src/views/player/button.vue:24–26`）。

#### WebCutTimeClock
- 功能：显示当前播放时间。
- 行为：监听播放器的 `timeupdate` 事件，将纳秒时间转换为可读格式并显示。

### 管理器组件

#### WebCutManager
- 功能：时间线轨与片段编辑容器。
- 入参：`topBarColor?`、`railBgColor?`、`segmentBgColor?`、`segmentBorderColor?`、`segmentHandlerColor?`、`asideWidth?`、`disableEmptyRail?`、`railHeight?`、`railHeightByType?`、`disableSort?`、`disableResize?`（`src/views/manager/index.vue:21–38`）。
- 事件：片段排序/尺寸调整触发 `sort`、`resize`（`src/views/manager/index.vue:18`、`src/views/manager/index.vue:151`）。
- 双向：`maxHeight` 控制内部滚动区域高度（`src/views/manager/index.vue:20`）；公开 `resizeManagerMaxHeight(h)`（`src/views/manager/index.vue:90–93`）。
- 行为：按类型自动计算轨高、左右滚动区联动、具备插槽用于渲染轨侧边与片段（`src/views/manager/index.vue:67–88`, `src/views/manager/index.vue:126–157`）。

#### WebCutManagerContainer
- 功能：时间线容器，管理滚动区域和缩放。
- 结构：包含左右滚动区域、标尺和管理器主体，实现滚动联动和缩放控制。

#### WebCutManagerScaler
- 功能：时间线缩放控制，驱动 `scale` 网格缩放（`src/views/manager/scaler/index.vue`）。
- 行为：通过滑块调整时间线缩放比例，影响网格尺寸和时间显示精度。

#### WebCutManagerAsideRail
- 功能：时间线轨道侧边栏，显示轨道信息和控制。
- 功能：显示轨道名称、类型、可见性和静音控制。
- 行为：支持轨道的隐藏/显示切换和静音/取消静音操作。

#### WebCutManagerMainSegment
- 功能：时间线片段编辑主区域。
- 行为：处理片段的拖动、调整大小、选择等交互操作。

#### WebCutManagerToolBar
- 功能：时间线工具栏，提供片段编辑工具。
- 功能：包含分割、删除、清空等工具按钮，用于编辑时间线片段。

### 片段组件

#### WebCutVideoSegment
- 功能：视频片段渲染组件。
- 行为：在时间线上显示视频片段，支持拖动、调整大小和编辑。

#### WebCutAudioSegment
- 功能：音频片段渲染组件。
- 行为：在时间线上显示音频片段，支持拖动、调整大小和编辑。

#### WebCutImageSegment
- 功能：图片片段渲染组件。
- 行为：在时间线上显示图片片段，支持拖动、调整大小和编辑。

#### WebCutTextSegment
- 功能：文本片段渲染组件。
- 行为：在时间线上显示文本片段，支持拖动、调整大小和编辑。

### 工具组件

#### WebCutClearTool
- 功能：清空时间线工具。
- 行为：清空所有轨道上的片段，重置时间线状态。

#### WebCutDeleteTool
- 功能：删除片段工具。
- 行为：删除选中的片段或轨道。

#### WebCutSplitTool
- 功能：分割片段工具。
- 行为：在当前游标位置分割选中的片段。

#### WebCutSplitKeepLeftTool
- 功能：分割并保留左侧片段工具。
- 行为：在当前游标位置分割片段，并保留左侧部分，删除右侧部分。

#### WebCutSplitKeepRightTool
- 功能：分割并保留右侧片段工具。
- 行为：在当前游标位置分割片段，并保留右侧部分，删除左侧部分。

#### WebCutFlipHorizontalTool
- 功能：水平翻转工具。
- 行为：水平翻转选中的视频或图片片段。

#### WebCutConcatTool
- 功能：拼接片段工具。
- 行为：将多个片段拼接成一个连续的片段。

### 面板组件

#### WebCutPanel
- 功能：编辑器右侧面板容器。
- 结构：根据选中的片段类型动态切换显示不同的编辑面板。

#### WebCutTextPanel
- 功能：文本片段编辑面板。
- 行为：提供文本内容、样式、动画等编辑选项。

#### WebCutBasicPanel
- 功能：基本片段属性编辑面板。
- 行为：提供片段的基本属性编辑，如位置、大小、旋转、透明度等。

### 素材库组件

#### WebCutLibrary
- 功能：项目素材库，支持列表、添加、删除（`src/hooks/library.ts:14–59`）。
- 行为：管理项目中使用的所有媒体素材，支持添加、删除和预览。

### 导出组件

#### WebCutExportButton
- 功能：导出按钮组件。
- 行为：触发媒体导出流程，支持选择导出格式和参数。

#### WebCutSelectAspectRatio
- 功能：按预设比例更新画布尺寸。
- 入参：`{ displayAspect?: boolean }`（`src/views/select-aspect-ratio/index.vue:14–17`）。
- 行为：
  - 比较 `width/height` 与预设比例以展示当前比例（`src/views/select-aspect-ratio/index.vue:74–86`）。
  - 选择时写入 `width/height`（`src/views/select-aspect-ratio/index.vue:89–95`）。
  - 选项包括 `21:9`、`16:9`、`4:3`、`9:16`、`3:4`、`1:1` 的具体目标尺寸（`src/views/select-aspect-ratio/index.vue:64–72`）。

### 主题与语言组件

#### WebCutThemeSwitch
- 功能：控制暗色模式。
- 行为：切换编辑器的明暗主题，影响所有UI组件的样式。

#### WebCutLangSwitch
- 功能：切换语言。
- 行为：切换编辑器的显示语言，支持多语言国际化。

### 实用组件

#### AdjustableBox
- 功能：可调整大小的容器组件。
- 行为：允许用户拖动调整容器的大小，支持限制最小和最大尺寸。

#### AudioShape
- 功能：音频波形可视化组件。
- 行为：根据音频数据生成可视化波形图。

#### ContextMenu
- 功能：上下文菜单组件。
- 行为：右键点击时显示上下文菜单，提供快捷操作选项。

#### ScrollBox
- 功能：自定义滚动容器组件。
- 行为：提供自定义的滚动条样式和滚动行为。

#### DraggableHandler
- 功能：可拖动的手柄组件。
- 行为：提供可拖动的手柄，用于调整大小或位置。

#### RotateInput
- 功能：旋转角度输入组件。
- 行为：提供直观的旋转角度调整界面，支持拖动和输入。

## 钩子

### 组件钩子

#### useScrollBox
- 功能：ScrollBox 组件的钩子，管理滚动行为。
- 来源：`src/components/scroll-box`
- 行为：处理滚动事件，实现自定义滚动条和滚动逻辑。

### 核心钩子

#### useWebCutContext(providedContext?: Partial<WebCutContext>)
- 功能：提供/消费响应式的编辑器状态。根组件传入 `providedContext` 时创建并提供，否则注入或构造默认值（`src/hooks/index.ts:19–65`，`src/hooks/index.ts:95`）。
- 默认值（`src/hooks/index.ts:20–45`）：
  - `id`、`width`、`height`、`viewport: HTMLDivElement|null`、`canvas: AVCanvas|null`
  - `clips: MP4Clip|ImgClip|AudioClip[]`、`sprites: VisibleSprite[]`、`sources: Map<string, WebCutSource>`
  - `cursorTime`（纳秒）、`status: -1|0|1`（停/暂/播）（`src/types/index.ts:24–27`）
  - `disableSelectSprite`、`autoResetWhenStop`
  - `fps`、`scale`（时间线缩放 [0,100]）
  - 时间线引用：`scroll1`、`scroll2`、`ruler`、`manager`、`player`
  - `rails: WebCutRail[]`、选中 `selected[]`、当前 `current: string|null`、撤销/重做标记
- 派生/计算（`src/hooks/index.ts:66–174`）：
  - `duration` 由 sprites 结束时间计算；当 `status` 停止且游标仍在范围内时自动切到暂停（`src/hooks/index.ts:66–93`）。
  - `currentRail`、`currentSegment`、`currentSource` 由选中状态计算（`src/hooks/index.ts:132–174`）。
- 操作（`src/hooks/index.ts:97–130`）：
  - `toggleSegment(segmentId, railId)`、`selectSegment`、`unselectSegment` 维护选中。
- 返回：所有引用、`duration`、`updateDuration`、`provide()`、选中操作与当前 getter（`src/hooks/index.ts:176–189`）。

#### useWebCutPlayer()
- 功能：播放器与媒体操作，绑定上下文与 `AVCanvas`。
- 画布生命周期/事件（`src/hooks/index.ts:232–301`）：
  - `init()` 创建画布、加入现有 sprites、监听并转发 `timeupdate`、`playing`、`paused`、`activeSpriteChange`，并与 `sources` 同步选中。
  - `play()`、`pause()`、`reset()` 控制播放与游标（`src/hooks/index.ts:303–328`）。
  - `moveTo(timeNs)` 定位预览但不播放（`src/hooks/index.ts:760–767`）。
  - `resize()` 触发 PlayerScreen 重新自适应（`src/hooks/index.ts:783–785`）。
- 导出（`src/hooks/index.ts:330–351`）：`exportBlob()` 从合成器流出 MP4；`exportAsWavBlob()` 通过 `mp4BlobToWavBlob` 转 WAV。
- 素材（`src/hooks/index.ts:353–564`）：
  - `push(type, source, meta)` 支持 `video|audio|image|text` 来源：`File`、`data:URL`、`file:<id>`、`http(s)`。处理音量、图片/视频自动适配、默认时长（图/文 2s）、zIndex、时间偏移等。
  - 创建 `VisibleSprite` 并写入 `sources`（包含 `fileId/url/text/segmentId/railId/meta`）（`src/hooks/index.ts:547–559`）。
  - 轨道分配：按类型自动建轨、视频轨标记 `main`，遇到交叠自动新增轨并重排（`src/hooks/index.ts:508–545`）。
  - `remove(key)`、`clear()`、`destroy()` 负责销毁与清理（`src/hooks/index.ts:566–633`）。
- 文本工具（`src/hooks/index.ts:634–758`）：
  - `initTextMaterial(text, css?, highlights?)` 渲染文本位图，计算位置与旋转（`--transform-rotate`），并规范 CSS（`src/hooks/index.ts:634–691`）。
  - `updateText(key, { text?, css?, highlights? })` 用保持时间/属性的新 `ImgClip` 替换旧 sprite，并更新 `sources.meta.text`（`src/hooks/index.ts:699–758`）。
- 其他：
  - `captureImage()` 返回当前帧图像（`src/hooks/index.ts:769–772`）。
  - `readSources()` 返回 `Map<string, WebCutSource>`（`src/hooks/index.ts:774–776`）。
  - `download(filename?)` 导出 MP4 并触发下载（`src/hooks/index.ts:778–781`）。

#### useWebCutData()
- 功能：管理编辑器数据，处理数据的加载、保存和更新。
- 来源：`src/hooks/index.ts`
- 行为：提供数据管理功能，支持项目数据的持久化和恢复。

#### useWebCutThemeColors()
- 功能：管理主题颜色。
- 来源：`src/hooks/index.ts`
- 行为：提供主题颜色的获取和管理功能，支持自定义主题。

#### useWebCutDarkMode()
- 功能：管理暗色模式状态。
- 来源：`src/hooks/index.ts`
- 行为：处理暗色模式的切换和状态管理。

参数：`WebCutMaterialMeta`（`src/types/index.ts:119–151`）
- `id?`：自定义素材 key
- `rect?`：`{ x,y,w,h,angle }`
- `time?`：`{ start?, duration?, playbackRate? }`
- `audio?`：`{ volume?, loop? }`（音频或含音轨视频）
- `video?`：`{ volume? }`
- `text?`：`{ css?, highlights? }`（文本渲染）
- `zIndex?`：图层顺序
- `autoFitRect?`：`'contain'|'cover'|'contain_scale'|'cover_scale'`
- `withRailId?`、`withSegmentId?`：放入指定轨/片段（用于历史恢复）

#### useWebCutManager()
- 功能：时间线计算与片段操作（`src/hooks/manager.ts`）。
- 游标与网格：
  - `totalFrameCount`、`totalPx`、`cursorFrame`、`cursorPx`（`src/hooks/manager.ts:34–55`）。
  - `moveCursorToTime(ns)`、`moveCursorToFrame(frame)`、`moveCursorToPx(px)` 预览并暂停（`src/hooks/manager.ts:68–87`）。
  - `timeToPx(ns)`、`pxToTime(px)`、`pxOf1Frame`、`timeOf1Frame`（`src/hooks/manager.ts:89–107`）。
- 片段：
  - `resetSegmentTime(segment)` 写回 sprite 时间并更新总时长（`src/hooks/manager.ts:109–119`）。
  - `toggleRailHidden(rail)` 统一隐藏/显示轨上所有 sprite（`src/hooks/manager.ts:125–136`）。
  - `toggleRailMute(rail)` 通过设置 `clip.tickInterceptor` 屏蔽音频数据（`src/hooks/manager.ts:138–158`）。
  - `deleteSegment({ segment, rail })` 销毁并移除片段，轨为空则移除，清除选中（`src/hooks/manager.ts:160–179`）。
  - `splitSegment({ segment, rail, keep })` 以游标时间切分：视频/音频进行编解码切分并以文件重新推入；图片/文本复制片段并调整时间；保留 `tickInterceptor`（`src/hooks/manager.ts:181–298`）。
- 滚动联动与居中（`src/hooks/manager.ts:13–32, 56–66`）。
- 返回：`scroll1`、`scroll2`、`ruler` 与 `resizeManagerMaxHeight(h)`（`src/hooks/manager.ts:120–123, 300–325`）。

#### useWebCutLibrary()
- 功能：项目文件管理。
- 返回：`projectId`、`projectData`、`projectFiles`、`files`、`addNewFile(file)`、`removeFile(fileId)`（`src/hooks/library.ts:51–59`）。
- 行为：
  - 加载项目与文件列表；通过 id 交集得出项目文件（`src/hooks/library.ts:19–22`）。
  - 项目变更时初始化数据与文件（`src/hooks/library.ts:24–31`）。
  - `addNewFile` 以 MD5 去重，添加到全局与项目关系并刷新（`src/hooks/library.ts:32–43`）。
  - `removeFile` 更新关系并刷新（`src/hooks/library.ts:45–49`）。

#### useWebCutLocalFile()
- 功能：为本地 OPFS 文件生成并缓存 `blob:` URL。
- 返回：`applyFileUrl(fileId)`、`fileUrl(fileId)`、`readFile(fileId)`（`src/hooks/local-file.ts:6–55`）。
- 行为：为每个 fileId 维护 Promise 缓存，避免重复读取；成功后持久化 `url`。

#### useWebCutHistory()
- 功能：撤销/重做与历史持久化/恢复。
- 实现：
  - 每个项目一个 `HistoryMachine`（`src/hooks/history.ts:12–24`）。
  - 监听 `rails` 与规范化的 `sources` 保存到 DB（`src/hooks/history.ts:43–59`）。
  - `convertSource` 将运行时对象转为可存的 meta（`src/hooks/history.ts:60–84`）。
  - `recoverProjectState()` 从保存状态重新推入素材与片段（`src/hooks/history.ts:111–137`）。
  - `pushHistory(state)` 格式化并保存特定操作如删除（`src/hooks/history.ts:139–160`）。
  - `undo()` 重新添加删除素材；`redo()` 再次删除（`src/hooks/history.ts:162–202`）。
  - `clearHistory()` 清空；`canUndo`、`canRedo`、`canRecover` 反映可用性（`src/hooks/history.ts:204–221`）。

### 国际化钩子

#### useWebCutLocale()
- 功能：国际化语言管理。
- 来源：`src/hooks/i18n`
- 行为：提供语言切换和本地化支持，管理编辑器的多语言显示。

## 库函数

### 核心库函数（`src/libs/index.ts`）
- `renderTxt2ImgBitmap(text, css?, highlights?)` 文本渲染成位图（`src/libs/index.ts:27`）。
- `createTxt2Img` 创建文本转图像实例。
- `buildTextAsDOM({ text, css?, highlights? })` 构建渲染 DOM（`src/libs/index.ts:86`）。
- `cssToText`、`textToCss` 在对象与样式文本间转换（`src/libs/index.ts:248, 276`）。
- `measureAudioDuration` 测量音频时长。
- `measureImageSize` 测量图片尺寸。
- `measureTextSize` 测量文本尺寸。
- `measureVideoDuration` 测量视频时长。
- `measureVideoSize` 测量视频尺寸。
- `autoFitRect(canvasSize, elementSize, type?)` 返回 contain/cover 方案的矩形（`src/libs/index.ts:477`）。
- `formatTime(ns)` 友好时间字符串（`src/libs/index.ts:512`）。
- `mp4ClipToBlob` 将 MP4 片段转换为 Blob。
- `mp4ClipToFile(clip)` 将 MP4 片段转换为文件。
- `audioClipToFile(clip)` 将音频片段转换为文件。
- `pcmToWav(pcmData, sampleRate?)` 将 PCM 数据转换为 WAV 格式。
- `exportBlobOffscreen` 离屏导出 Blob。
- `exportAsWavBlobOffscreen` 离屏导出 WAV Blob。
- `mp4BlobToWavArrayBuffer` 将 MP4 Blob 转换为 WAV ArrayBuffer。
- `mp4BlobToWavBlob` 将 MP4 Blob 转换为 WAV Blob。
- `mp4ClipToAudioClip` 将 MP4 片段转换为音频片段。
- `mp4ClipToFramesData` 将 MP4 片段转换为帧数据。
- `createImageFromVideoFrame` 从视频帧创建图片。
- `progressiveClipToPCMData` 渐进式将片段转换为 PCM 数据。

### 文件工具（`src/libs/file.ts`）
- `base64ToFile` 将 Base64 转换为文件。
- `blobToBase64DataURL` 将 Blob 转换为 Base64 DataURL。
- `fileToBase64DataURL` 将文件转换为 Base64 DataURL。
- `downloadBlob` 下载 Blob 文件。
- `getFileMd5` 获取文件 MD5 值。
- `blobToFile` 将 Blob 转换为文件。

### 数据库工具（`src/db/index.ts`）
- `getProject` 获取项目信息。
- `createNewProject` 创建新项目。
- `addFileToProject` 向项目添加文件。
- `removeFileFromProject` 从项目移除文件。
- `writeFile` 写入文件。
- `readFile` 读取文件。
- `addFile` 添加文件。
- `getFile` 获取文件。
- `getAllFiles` 获取所有文件。
- `moveProjectHistoryTo` 移动项目历史到指定位置。
- `pushProjectHistory` 推送项目历史。
- `getProjectHistory` 获取项目历史。
- `clearProjectHistory` 清空项目历史。
- `getProjectState` 获取项目状态。
- `updateProjectState` 更新项目状态。

## 类型定义

从 `src/types/index.ts` 导出的类型：
- `WebCutContext` 编辑器上下文类型。
- `WebCutHighlightOfText` 文本高亮类型。
- `WebCutSegmentOfText` 文本片段类型。
- `WebCutRailOfText` 文本轨道类型。
- `WebCutSegment` 片段类型。
- `WebCutRail` 轨道类型。
- `WebCutMaterialType` 素材类型。
- `WebCutMaterial` 素材类型。
- `WebCutMaterialMeta` 素材元数据类型。
- `WebCutSource` 素材源类型。
- `WebCutSourceData` 素材源数据类型。
- `WebCutProjectHistoryState` 项目历史状态类型。
- `WebCutProjectHistoryData` 项目历史数据类型。
- `WebCutColors` 颜色类型。