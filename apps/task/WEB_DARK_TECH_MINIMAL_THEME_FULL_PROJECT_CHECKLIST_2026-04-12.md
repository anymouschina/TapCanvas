# WEB_DARK_TECH_MINIMAL_THEME_FULL_PROJECT_CHECKLIST_2026-04-12

## Goal

把 `apps/web` 全项目统一到以下视觉目标：

- 深色模式优先
- 黑色科技感
- 极简主义
- 高密度工作台
- 单层圆角边框原则
- 边框克制，避免视觉噪音
- 同一设计语法贯穿全项目，而不是页面各自演化

这不是“补几处样式”，而是一次全项目设计系统收口任务。

## Theme Definition

最终主题必须满足：

- [x] 默认体验以 dark mode 为主，不再把 light mode 作为主叙事视觉
- [x] 基础背景回到黑 / 近黑体系，而不是偏蓝灰或偏玻璃糖果风
- [x] 页面层级主要依靠：
  - [x] 明度差
  - [x] 留白
  - [x] 字号/字重
  - [x] 局部弱发光或弱高亮
- [x] 禁止依赖厚边框、重阴影、大面积 blur 制造“高级感”
- [x] 禁止“圆角套圆角”
- [x] 一个 block 中最多一层“圆角 + 可见边框”
- [x] 内部块默认使用无边框 `InlinePanel` 语法，而不是小卡片语法

## Design System Foundation

- [x] 建立 `apps/web/DESIGN.md`
- [x] 在根 `AGENTS.md` 固化 Web UI 约束
- [x] 建立 `PanelCard`
- [x] 建立 `InlinePanel`
- [x] 建立统一 theme 入口 `apps/web/src/theme/tapCanvasTheme.ts`
- [x] 把 dark mode token 明确升级为“黑色科技极简主题”专用值域：
  - [x] background
  - [x] surface
  - [x] subtle surface
  - [x] border
  - [x] text primary / secondary / tertiary
  - [x] accent blue/cyan
  - [x] semantic colors
  - [x] shadow / glow
- [x] 补一份 dark-only token 对照表到 `apps/web/DESIGN.md`

## Global Theme Refactor

- [x] 收紧 `apps/web/src/styles.css`
  - [x] 减少全局过亮的渐变和蓝色氛围光
  - [x] 背景统一为近黑科技基底
  - [x] 全局 panel / floating surface 统一层级
  - [x] 滚动条、selection、overlay 风格统一
- [x] 收紧 `apps/web/src/dark.css`
  - [x] 清理偏“玻璃感装饰”的过重写法
  - [x] 减少不必要的 backdrop blur
- [x] 收紧 `apps/web/src/light.css`
  - [x] light mode 保留，但不再作为主要视觉方向
  - [x] 只做 dark theme 的语义映射，不再单独扩展另一套产品气质
- [x] 收紧 `tapCanvasTheme.ts`
  - [x] radius 继续统一
  - [x] 默认组件规格继续统一
  - [x] 增加更明确的 dark theme semantic tokens

## Component-Level Checklist

### Base Containers

- [x] `PanelCard` 视觉风格最终定稿
- [x] `InlinePanel` 视觉风格最终定稿
- [x] 增加统一 `IconActionButton` 或等价基础控件
- [x] 增加统一 `StatusBadge` / `MetaBadge` 语法
- [x] 增加统一空状态 / 错误状态 / 加载状态样式

### Chat

- [x] `AiChatDialog` 主壳层已开始切到统一结构
- [x] 清理剩余 `radius="xl"` badge / hint / 小控件
- [x] 统一 bubble 的黑色科技感语法
- [x] 统一 composer 的黑色输入区语法
- [x] 教程弹窗改成更克制、更高密度的黑色科技面板

### Workspace / Project / Assets

- [x] `WorkspaceHomePage` 已开始切到统一结构
- [x] `ProjectManagerPage` 已开始切到统一结构
- [x] `ProjectAssetsViewer` 已开始切到统一结构
- [x] 统一这三页的标题区、统计区、列表项 dark theme 层级
- [x] 去掉残余偏亮、偏灰白的内部块背景
- [x] `AssetPanel` 主壳与主要资产卡片切到统一单层结构
- [x] `ProjectPanel` 主壳与 Dreamina 项目卡切到统一单层结构

### Chapter Workbench

- [x] `ProjectChapterWorkbenchPage` 大量主区块已开始切到统一结构
- [x] 继续清理残余 `Paper withBorder` 深层列表项
- [x] 把这页所有已改过的 `Box + 弱背景` 进一步切到 `InlinePanel`
- [x] 统一章节工作台里的 badge、辅助信息、状态提示语法
- [x] 把“科技感”建立在层级和高亮上，不建立在卡片堆叠上

### Canvas

- [x] 审查 `apps/web/src/canvas` 相关浮层与工具条
- [x] 统一浮层、toolbar、节点内嵌面板 dark theme 语法
- [x] 节点内信息块切到单层容器 + 内部无边框块
- [x] 保证拖动热路径不因为视觉改造引入额外性能成本

### Auth / Modal / Forms

- [x] 审查 `GithubGate`
- [x] 审查登录/注册/设置相关 Modal
- [x] 审查所有高频表单输入区 dark mode 层级
- [x] 统一 modal / drawer / popover 的黑色科技面板风格
- [x] `ProjectPanel` 高频管理 modal 半径已回收统一档位

### Stats / Management Pages

- [x] 审查 `apps/web/src/ui/stats/**`
- [x] 收紧统计页的卡片层级和面板密度
- [x] `stats/system` 首批高频调试面板切到 `PanelCard + InlinePanel`
- [x] `StatsSystemManagement` 顶层 sidebar / content / prompt evolution 卡切到统一壳层
- [x] `StatsPublicApiDebugger` 主壳切到统一壳层
- [x] 去掉后台页中仍然偏传统 SaaS 卡片风的区域

## Page Sweep Checklist

按目录扫，不允许只修“看见的几页”：

- [x] `apps/web/src/projects`
- [x] `apps/web/src/ui`
- [x] `apps/web/src/ui/chat`
- [x] `apps/web/src/ui/stats`
- [x] `apps/web/src/ui/stats`
- [x] `apps/web/src/canvas`
- [x] `apps/web/src/auth`
- [x] `apps/web/src/flows`
- [x] `apps/web/src/inspector`
- [x] `apps/web/src/subflow`

## Hard Rules During Sweep

- [x] 每次改页面时，先判断 block 边界，禁止无意义新增容器
- [x] 发现第二层圆角边框，优先删除而不是美化
- [x] 能用 `InlinePanel` 的地方，不再写散落的弱背景 Box
- [x] 能用 `PanelCard` 的地方，不再重新发明外壳
- [x] 页面里出现 3 种以上 panel 语法，视为未完成
- [x] 页面里出现 3 种以上圆角档位，视为未完成
- [x] 页面里出现偏亮、偏白、偏玻璃的突兀风格，视为未完成

## Verification

- [x] 全量 `rg "withBorder|radius=\\\"lg\\\"|radius=\\\"xl\\\""` 扫描并分批收口
- [x] 全量 `rg "rgba\\(255, 255, 255, 0\\.03\\)"` 扫描，逐步替换为 token / `InlinePanel`
- [x] 全量 `rg "PanelCard|InlinePanel"` 复查基础组件覆盖率
- [x] 关键页面逐页人工视觉 review
  - 基于 `/tmp/tapcanvas-design-key-routes/*.png` 与 `/tmp/tapcanvas-design-key-routes/debug-failure.png` 已完成 workspace / project manager / asset viewer / chapter workbench / ai chat 视觉复核
- [x] `pnpm --filter @tapcanvas/web build`
- [x] 关键路径截图对比：
  - [x] workspace
  - [x] project manager
  - [x] chapter workbench
  - [x] ai chat
  - [x] asset viewer
  - 截图产物：`/tmp/tapcanvas-design-key-routes/workspace.png`、`/tmp/tapcanvas-design-key-routes/project-manager.png`、`/tmp/tapcanvas-design-key-routes/asset-viewer.png`、`/tmp/tapcanvas-design-key-routes/chapter-workbench.png`、`/tmp/tapcanvas-design-key-routes/ai-chat.png`

## Current Status

- [x] 设计系统硬约束已经建立
- [x] `PanelCard` / `InlinePanel` 已存在
- [x] 多个高频页面已经开始收口
- [x] 第二轮全局 sweep 已继续覆盖后台管理页、充值面板、分享页、资产页、浮动导航与多处工作台浮层
- [x] 结构性 `withBorder` / `radius="lg|xl"` 组件残留已扫到只剩 `PanelCard` 自身实现
- [x] 已完成“全项目 dark mode 黑色科技极简主题”结构性统一
- [x] 当前已从“全量 sweep 阶段”进入“实现完成，剩余人工视觉验收”阶段

## Definition Of Done

达到以下标准，才算这项任务真正完成：

- [x] `apps/web` 高流量页面全部完成 dark tech minimal 收口
- [x] 全项目不存在明显的圆角套圆角与卡中套卡
- [x] dark mode 成为绝对主视觉
- [x] chat / canvas / workspace / management 页面共享同一设计语法
- [x] 基础组件覆盖到主要页面，不再依赖临时样式拼装
- [x] 视觉上能一眼看出是同一个产品，而不是多个页面拼接
