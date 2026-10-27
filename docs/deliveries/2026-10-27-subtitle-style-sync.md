# 2026-10-27 字幕样式同步交付记录

## 来源与范围

本轮从同级 `TapCanvas-pro` 工作区同步 `TODO.md` 中 F02 的字幕样式子项。源码核对时来源 HEAD 为 `5f1babf6fa53d7d991cd357fa6215b82199b1c16`；参考文件为 `apps/web/src/canvas/nodes/taskNode/components/subtitles/SubtitleStyleControls.tsx`、`SubtitleColorPicker.tsx`、`types.ts`、`drawSubtitle.ts`、`StyledSubtitleClip.ts` 和 `components/composeVideosCore.ts`。

保留社区版 DSH Harness、现有字幕识别和剪辑链路。本轮不迁入 Pro Agent 内核、商业计费、服务端字幕转写，也不包含独立字幕轨、拖拽时间调整或完整 F02。F02 整体仍保持未完成。

## 社区版行为

- 视频合成编辑器在「内容 / 样式」视图之间切换。样式视图提供无衬线、衬线、等宽三类通用字体，支持相对画面高度的字号、粗体、文字颜色、描边颜色与宽度、背景颜色与不透明度、顶部/居中/底部位置、左/中/右对齐和上下边距。
- 字幕样式随 `node.data.composeSubtitles` 保存，重开编辑器恢复样式；小/中/大字号快捷设置仍可使用。
- 预览与浏览器本地导出使用同一个 Canvas 字幕绘制函数，按实际画面尺寸计算字号、位置和描边，避免预览与导出分别维护样式规则。
- 颜色控件支持 HEX 输入与色盘，未完成的输入保留为草稿，只提交结构合法的颜色；持久化样式的未知字段、无效颜色和越界数值显式报错。
- 样式只作用于字幕渲染，不改写字幕文本、识别回执或源视频资产。

## 截图

已查看 lluban.cn 的现有界面，但本轮未取得可公开且无私人内容的字幕样式截图：当前已打开画布没有对应编辑器，其他页面包含真实会话或账号信息。本轮未创建线上节点或素材，也未截取私人画布；README 不附截图，不将本地实验图冒充线上界面。

## 验证边界

- `pnpm --filter @tapcanvas/web exec vitest run --config _test/vitest.config.ts src/canvas/nodes/taskNode/components/subtitles/subtitleStyle.test.ts src/canvas/nodes/taskNode/components/composeVideosCore.worker.test.ts`：2 个文件、23 项通过，覆盖样式结构校验、共享绘制行为、字幕帧时间戳与释放，以及主线程 / Worker 参数传递。
- `pnpm --filter @tapcanvas/web test src/canvas/nodes/taskNode/components/VideoComposeEditorModal.subtitleStyle.test.tsx src/canvas/nodes/taskNode/components/subtitles/SubtitleStyleControls.test.tsx`：2 个文件、7 项通过，覆盖样式控件、预览参数、关闭保存与重开恢复、字号预设和导出参数传递。WebAV 与 Canvas 为测试替身，该测试不执行浏览器视频编码。
- `NODE_OPTIONS=--no-experimental-webstorage pnpm --filter @tapcanvas/web exec vitest run --config _test/vitest.config.ts src/portal/changelog/ChangelogLauncher.test.tsx`：1 个文件、3 项通过，验证新增条目后的日志展示与本地已读交互。
- `pnpm --filter @tapcanvas/web exec tsc --noEmit --pretty false` 通过；`git diff --check` 通过。
- 已按仓库规范尝试 `graphify update .`；当前环境未安装该命令（退出码 127），知识图未更新。

本地真实 Chrome 使用 WebAV 导出 320×180 MP4，并用 ffmpeg 抽帧核对字幕样式。主线程与 Worker 输出的绿色字幕边界均为 `[18,24,85,39]`，预览为 `[17,23,85,39]`；品红背景边界三者均为 `[12,14,90,41]`。这验证了一个本地样例的预览与实际导出路径，不代表所有媒体、浏览器或字体效果均已验收。

首次主线程实验出现过只有 AAC 音频包、没有 H.264 视频包的异常。随后记录编码日志，在 3 个独立浏览器上下文中分别比较旧字幕组件、新主线程、新 Worker 和无字幕输出，共 12 次均成功（各 31 个视频包、49 个音频包）；未复现首次异常，尚不能确认其根因，不能据此宣称编码问题已修复。

本轮未部署、未提交模型生成或转写任务。
