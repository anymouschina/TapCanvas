# WEB_DESIGN_SYSTEM_SINGLE_LAYER_PANEL_CHECKLIST_2026-04-12

## Goal

把 `apps/web` 收敛到统一设计语法：

- 单层圆角边框原则：一个独立 block 中最多只允许一层“圆角 + 可见边框”
- 极简主义优先：边框默认不是装饰语言
- 统一 token：圆角、字号、间距、阴影、组件默认规格必须收口
- 高密度工作台优先：减少软糖式 UI、减少卡中套卡、减少无意义包裹层

## Spec And Guardrails

- [x] 新建设计规范文档：`apps/web/DESIGN.md`
- [x] 在根 `AGENTS.md` 中写入强约束：
  - [x] 单层圆角边框原则
  - [x] 极简主义与边框克制原则
  - [x] `apps/web/DESIGN.md` 作为 Web UI 执行基线

## Theme And Tokens

- [x] 新建统一 theme 入口：`apps/web/src/theme/tapCanvasTheme.ts`
- [x] `apps/web/src/main.tsx` 改为消费统一 theme 构建函数
- [x] 收口 Mantine 默认 token：
  - [x] radius
  - [x] spacing
  - [x] font sizes
  - [x] headings
  - [x] shadows
  - [x] 常用组件 defaultProps（Button / ActionIcon / TextInput / Select / Modal / Menu / Badge 等）
- [x] `apps/web/src/styles.css` 补充基础 CSS token

## Base Components

- [x] 新建 `apps/web/src/ui/PanelCard.tsx`
- [x] 让 `PanelCard` 默认承担“唯一一层圆角边框容器”职责
- [x] `PanelCard` 支持 `ref` 转发，允许用于菜单/浮层等真实交互壳层
- [x] 在全局样式里增加 `tc-panel-card` 嵌套约束，避免二次圆角边框扩散
- [x] 新建 `apps/web/src/ui/InlinePanel.tsx`
- [x] 让 `InlinePanel` 承担“无边框内部信息块”职责
- [x] 在全局样式里增加 `tc-inline-panel` 默认弱底色语法
- [x] 新建 `IconActionButton`
- [x] 新建 `StatusBadge`
- [x] 新建 `StatePanel`

## Pages Already Cut Over

### Workspace

- [x] `apps/web/src/projects/WorkspaceHomePage.tsx`
  - [x] 顶部概览区改为 `PanelCard + 内部信息块`
  - [x] 空状态卡改为 `PanelCard`
  - [x] summary cards 改为 `PanelCard`
  - [x] 最近章节 / 待返工镜头 / 运行中任务列表改为单层结构
  - [x] 内部无边框块切到 `InlinePanel`

### Project Manager

- [x] `apps/web/src/projects/ProjectManagerPage.tsx`
  - [x] 顶部快速开始区改为 `PanelCard + 内部 step 信息块`
  - [x] quickstart step 信息块切到 `InlinePanel`

### Project Assets

- [x] `apps/web/src/projects/ProjectAssetsViewer.tsx`
  - [x] 顶部概览区改为 `PanelCard + 内部指标块`
  - [x] 项目统计区去掉内层边框卡
  - [x] 顶部指标块 / 统计块切到 `InlinePanel`

### Art Style Picker

- [x] `apps/web/src/projects/ProjectArtStylePresetPicker.tsx`
  - [x] 外层卡切到 `PanelCard`
  - [x] 内层封面预览去掉额外圆角

### Chapter Workbench

- [x] `apps/web/src/projects/ProjectChapterWorkbenchPage.tsx`
  - [x] 本章现在该做什么
  - [x] 本章操作路径
  - [x] 本章可复用资源
  - [x] 项目共享库存
  - [x] 文本与共享资源
  - [x] 本章生产履历
  - [x] 最近生产动作
  - [x] 返工原因定位
  - [x] 共享资源总览
  - [x] 当前镜头资源
  - [x] 资源影响诊断
  - [x] 项目设定
  - [x] 镜头控制区主壳
  - [x] 当前镜头工作区主壳
  - [x] Step 1 / Step 2 / Step 3 大块改为单层结构
  - [x] 最近结果外壳改轻量信息块
  - [x] 加载失败态改为 `PanelCard`

### AI Chat

- [x] `apps/web/src/ui/chat/AiChatDialog.tsx`
  - [x] chat bubble 外壳切到 `PanelCard`
  - [x] tutorial intro 切到 `PanelCard`
  - [x] tutorial card 切到 `PanelCard`
  - [x] compact composer 切到 `PanelCard`
  - [x] expanded composer 切到 `PanelCard`
  - [x] 主 chat card 半径从 `xl` 收回统一 panel 半径

## Local Fixes Added During Cutover

- [x] `GithubGate` children 签名导致的空 children 调用点已在相关页面补为显式空 children：
  - [x] `WorkspaceHomePage`
  - [x] `ProjectManagerPage`
  - [x] `ProjectChapterWorkbenchPage`
- [x] `GithubGate` 登录卡主壳切到 `PanelCard`
- [x] `StatsFullPage` 概览卡、图表卡、厂商卡切到 `PanelCard + InlinePanel`
- [x] `Canvas` 主浮层、选择条、上下文菜单、插入菜单主壳切到统一 `PanelCard`
- [x] `ProjectChapterWorkbenchPage` 中段大块与镜头工作区继续批量切到 `InlinePanel`
- [x] `AiChatDialog` 主要 badge / hint / tutorial 小控件的 `xl` 半径已收回
- [x] `StatsRuntimeDiagnostics` / `StatsMemoryDebugger` / `StatsMemoryContextDebugger` 切到 `PanelCard + InlinePanel`
- [x] `StatsSystemManagement` 顶层侧栏与主区壳层切到 `PanelCard`
- [x] `StatsPublicApiDebugger` 主壳切到 `PanelCard`
- [x] `AssetPanel` 主壳与主要资产卡切到 `PanelCard`
- [x] `ProjectPanel` 主壳与 Dreamina 项目卡切到 `PanelCard + InlinePanel`

## Verification

- [x] 逐轮用 `rg` 检查目标页面是否仍保留明显的 “外层大卡 + 内层多张 withBorder/radius 卡” 结构
- [x] 逐轮用定向 `tsc` 过滤检查本轮修改文件是否引入新的类型错误
- [x] `pnpm --filter @tapcanvas/web build`
  - 使用 `VITE_API_BASE=http://127.0.0.1:8787 ALLOW_LOCALHOST_IN_PROD_BUILD=1` 已通过

## Known Unrelated Type Errors

- [x] 本轮 checklist 中明确记录的 `ProjectChapterWorkbenchPage` 存量类型问题已一并修复，不再保留尾项

## Remaining Cleanup

这些项目已完成本轮设计系统收口：

- [x] 继续清理 `ProjectChapterWorkbenchPage` 中残余的深层 `Paper withBorder` 列表项
- [x] 收紧 `AiChatDialog` 中剩余 `radius="xl"` 的 badge / 小控件，统一到更克制的尺寸语法
- [x] 抽一个统一的无边框内部块组件，例如 `InfoBlock` / `InlinePanel`
- [x] 用基础组件替换当前散落的 `Box + padding + weak background` 内部块写法
- [x] 对 `apps/web` 其余页面做一次全量 `withBorder + radius` 扫描，按 block 语义继续收口
- [x] 继续清理剩余高频文件：
  - [x] `apps/web/src/projects/ProjectManagerPage.tsx`
  - [x] `apps/web/src/ui/TapshowFullPage.tsx`
  - [x] `apps/web/src/ui/TemplatePanel.tsx`
  - [x] `apps/web/src/canvas/components/PromptSampleDrawer.tsx`
  - [x] `apps/web/src/ui/stats/commerce/StatsCommerceManagement.tsx`

## Definition Of Done For This Phase

- [x] 规则已写入文档与仓库强约束
- [x] theme/token 已统一入口
- [x] 基础 `PanelCard` 已建立
- [x] Web 的高频主页面和核心工作台已开始按单层圆角边框原则重构
- [x] 当前阶段可以视为“设计系统硬约束已落地，核心页面与全局结构已完成收口”
