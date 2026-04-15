# WEB Apple Density Adaptation Full Redesign Checklist

## 目标

基于根目录 [`Design.md`](/Users/libiqiang/workspace/TapCanvas-pro/Design.md) 对 `apps/web` 做全量视觉重定义。

执行原则不是机械复刻 Apple 官网，而是：

- 继承 Apple 风格的视觉语法
- 保留 TapCanvas 作为高密度创作工作台的可用性
- 以统一设计系统先行，而不是页面各自改样式

## 设计方向

- 视觉主题：黑 / 浅灰二元节奏，单一 Apple Blue 交互色，极简容器语言
- 排版系统：Display / Body 分层，强调标题节奏与稳定正文可读性
- 组件语言：少边框、少装饰、弱 chrome、强层级
- 交互策略：克制动效、克制阴影、克制 blur
- 产品约束：允许高密度，但不允许回退到科技感渐变工具台视觉

## 总体施工顺序

1. 设计系统基建
2. 基础组件层
3. 应用外壳与导航
4. 首页与登录前页面
5. Canvas 视觉系统
6. TaskNode 主体重构
7. 项目页与业务工作流页
8. 次级模块与后台收口
9. 文档同步与验收

## Phase 1 设计系统基建

### 目标

先重建全局 tokens、Mantine theme 和 Web 执行规范，作为后续所有页面的唯一样式底盘。

### 文件

- [`apps/web/src/theme/tapCanvasTheme.ts`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/theme/tapCanvasTheme.ts)
- [`apps/web/src/styles.css`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/styles.css)
- [`apps/web/src/dark.css`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/dark.css)
- [`apps/web/src/light.css`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/light.css)
- [`apps/web/src/ui/styleReference.ts`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/ui/styleReference.ts)
- [`apps/web/DESIGN.md`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/DESIGN.md)

### Checklist

- [ ] 建立全局颜色 token：`#000000` / `#f5f5f7` / `#1d1d1f` / `#0071e3` 为核心语义色
- [ ] 建立 surface 层级 token，禁止页面自由发明背景色
- [ ] 建立 typography token，映射 display/body/caption/button/text 层级
- [ ] 建立 radius / shadow / border / focus token
- [ ] 重写 Mantine 默认样式映射
- [ ] 删除全局 radial gradient、科技感背景纹理、蓝青 glow 氛围层
- [ ] 明确 dark/light 对照关系，避免双轨漂移
- [ ] 更新 `apps/web/DESIGN.md` 为 Web 执行映射规范

### 验收

- [ ] 新组件在不写局部样式时也能自动落到新视觉系统
- [ ] 全局背景和基础文本风格已经从现有 dark-tech 方案切走

## Phase 2 基础组件层

### 目标

先统一复用组件，不让页面各自再写一套视觉规则。

### 文件

- [`apps/web/src/ui/PanelCard.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/ui/PanelCard.tsx)
- [`apps/web/src/ui/InlinePanel.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/ui/InlinePanel.tsx)
- [`apps/web/src/ui/IconActionButton.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/ui/IconActionButton.tsx)
- [`apps/web/src/ui/StatusBadge.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/ui/StatusBadge.tsx)
- [`apps/web/src/ui/toast.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/ui/toast.tsx)
- [`apps/web/src/ui/PreviewModal.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/ui/PreviewModal.tsx)
- [`apps/web/src/ui/ExecutionLogModal.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/ui/ExecutionLogModal.tsx)
- [`apps/web/src/ui/RechargeModal.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/ui/RechargeModal.tsx)
- [`apps/web/src/ui/ParamModal.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/ui/ParamModal.tsx)

### Checklist

- [ ] 统一 `PanelCard` 的 surface、留白、圆角、阴影语义
- [ ] 统一 `InlinePanel` 的弱层级表达
- [ ] 重做 icon action 组件，统一媒体控件和工具控件风格
- [ ] 统一 badge / status / toast 视觉
- [ ] 重做 modal/drawer/popover 的标题区、关闭按钮、内容区
- [ ] 收敛按钮类型为固定集合：primary blue / dark / pill link / filter / icon control
- [ ] 收敛输入框和选择器的高度、边框、背景与 focus 样式

### 验收

- [ ] 基础组件之间没有视觉打架
- [ ] 不再出现厚描边、多层卡片、局部临时颜色

## Phase 3 应用外壳与导航

### 目标

先修正工作台的第一层观感。

### 文件

- [`apps/web/src/App.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/App.tsx)
- [`apps/web/src/ui/FloatingNav.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/ui/FloatingNav.tsx)
- [`apps/web/src/ui/AccountPanel.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/ui/AccountPanel.tsx)
- [`apps/web/src/ui/ProjectPanel.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/ui/ProjectPanel.tsx)
- [`apps/web/src/ui/AssetPanel.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/ui/AssetPanel.tsx)
- [`apps/web/src/ui/HistoryPanel.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/ui/HistoryPanel.tsx)
- [`apps/web/src/ui/TemplatePanel.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/ui/TemplatePanel.tsx)
- [`apps/web/src/ui/ExecutionPanel.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/ui/ExecutionPanel.tsx)
- [`apps/web/src/ui/ModelPanel.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/ui/ModelPanel.tsx)

### Checklist

- [ ] 重做顶部导航为 Apple 风格半透明黑色 chrome
- [ ] 统一侧边面板的容器语言
- [ ] 统一 panel header、tool actions、filter bar 和滚动区样式
- [ ] 收敛所有面板中的按钮和状态表达
- [ ] 统一应用外壳留白、边距、面板间距

### 验收

- [ ] 进入应用后的外壳观感已经脱离旧 dark-tech 风格

## Phase 4 首页与登录前页面

### 目标

先统一对外入口与品牌层表达。

### 文件

- [`apps/web/src/ui/HomePage.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/ui/HomePage.tsx)
- [`apps/web/src/ui/homePage.css`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/ui/homePage.css)
- [`apps/web/src/ui/ShareFullPage.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/ui/ShareFullPage.tsx)
- [`apps/web/src/ui/TapshowFullPage.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/ui/TapshowFullPage.tsx)
- [`apps/web/src/auth/GithubGate.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/auth/GithubGate.tsx)

### Checklist

- [ ] 重构首页 section 节奏为黑 / 浅灰交替
- [ ] 重构 hero 结构与主视觉逻辑
- [ ] 重构核心卖点区、媒体区、CTA 区
- [ ] 统一公共页、分享页、登录门页的视觉语言
- [ ] 清理营销页上的多余装饰性边框和渐变

### 验收

- [ ] 首页与应用内视觉属于同一产品，而不是两套语言

## Phase 5 Canvas 视觉系统

### 目标

重构画布背景、连线、控件和节点基础气质。

### 文件

- [`apps/web/src/canvas/Canvas.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/canvas/Canvas.tsx)
- [`apps/web/src/canvas/utils/canvasTheme.ts`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/canvas/utils/canvasTheme.ts)
- [`apps/web/src/canvas/edges/TypedEdge.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/canvas/edges/TypedEdge.tsx)
- [`apps/web/src/canvas/edges/OrthTypedEdge.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/canvas/edges/OrthTypedEdge.tsx)
- [`apps/web/src/canvas/edges/useEdgeVisuals.ts`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/canvas/edges/useEdgeVisuals.ts)
- [`apps/web/src/canvas/nodes/GroupNode.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/canvas/nodes/GroupNode.tsx)
- [`apps/web/src/canvas/nodes/IONode.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/canvas/nodes/IONode.tsx)

### Checklist

- [ ] 重写 React Flow 相关 CSS variable
- [ ] 去掉科技感画布背景和发光网格
- [ ] 收敛 selection / edge / handle / minimap / controls 样式
- [ ] 统一 group node / io node 的容器语言
- [ ] 重做画布空态与执行态覆盖层

### 验收

- [ ] 画布底层已经与新的全局设计系统一致

## Phase 6 TaskNode 主体重构

### 目标

完成核心生产节点的全量视觉改造。

### 文件

- [`apps/web/src/canvas/nodes/TaskNode.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/canvas/nodes/TaskNode.tsx)
- [`apps/web/src/canvas/nodes/taskNode/components/TaskNodeHeader.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/canvas/nodes/taskNode/components/TaskNodeHeader.tsx)
- [`apps/web/src/canvas/nodes/taskNode/components/TopToolbar.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/canvas/nodes/taskNode/components/TopToolbar.tsx)
- [`apps/web/src/canvas/nodes/taskNode/components/ControlChips.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/canvas/nodes/taskNode/components/ControlChips.tsx)
- [`apps/web/src/canvas/nodes/taskNode/components/StatusBanner.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/canvas/nodes/taskNode/components/StatusBanner.tsx)
- [`apps/web/src/canvas/nodes/taskNode/components/GenerationOverlay.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/canvas/nodes/taskNode/components/GenerationOverlay.tsx)
- [`apps/web/src/canvas/nodes/taskNode/components/ImageContent.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/canvas/nodes/taskNode/components/ImageContent.tsx)
- [`apps/web/src/canvas/nodes/taskNode/components/VideoContent.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/canvas/nodes/taskNode/components/VideoContent.tsx)
- [`apps/web/src/canvas/nodes/taskNode/components/TextContent.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/canvas/nodes/taskNode/components/TextContent.tsx)
- [`apps/web/src/canvas/nodes/taskNode/components/PromptSection.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/canvas/nodes/taskNode/components/PromptSection.tsx)
- [`apps/web/src/canvas/nodes/taskNode/components/StructuredPromptSection.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/canvas/nodes/taskNode/components/StructuredPromptSection.tsx)
- [`apps/web/src/canvas/nodes/taskNode/components/UpstreamReferenceStrip.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/canvas/nodes/taskNode/components/UpstreamReferenceStrip.tsx)
- [`apps/web/src/canvas/nodes/taskNode/components/MosaicModal.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/canvas/nodes/taskNode/components/MosaicModal.tsx)
- [`apps/web/src/canvas/nodes/taskNode/components/VeoImageModal.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/canvas/nodes/taskNode/components/VeoImageModal.tsx)
- [`apps/web/src/canvas/nodes/taskNode/VideoResultModal.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/canvas/nodes/taskNode/VideoResultModal.tsx)

### Checklist

- [ ] 拆清 header / toolbar / content / footer 的视觉职责
- [ ] 删除节点内部多余 chip 堆叠与边框堆叠
- [ ] 统一媒体节点与文本节点的主框架
- [ ] 重构 prompt 编辑区与结构化字段区
- [ ] 重构状态 banner、进度 overlay、引用 strip
- [ ] 同步改造节点相关 modal
- [ ] 必要时先继续拆分 `TaskNode.tsx`，再做视觉重构

### 验收

- [ ] 核心节点看起来是产品级内容容器，不是工程面板拼装

## Phase 7 项目页与业务工作流页

### 目标

把主业务页面统一到新的设计系统。

### 文件

- [`apps/web/src/projects/WorkspaceHomePage.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/projects/WorkspaceHomePage.tsx)
- [`apps/web/src/projects/ProjectManagerPage.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/projects/ProjectManagerPage.tsx)
- [`apps/web/src/projects/ProjectChapterWorkbenchPage.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/projects/ProjectChapterWorkbenchPage.tsx)
- [`apps/web/src/projects/ProjectAssetsViewer.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/projects/ProjectAssetsViewer.tsx)
- [`apps/web/src/projects/ProjectArtStylePresetPicker.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/projects/ProjectArtStylePresetPicker.tsx)
- [`apps/web/src/flows/LibraryEditor.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/flows/LibraryEditor.tsx)

### Checklist

- [ ] 重构工作区首页布局与层级
- [ ] 重构项目管理页的列表 / 详情 / 筛选区
- [ ] 重构章节工作台的面板和工作流引导
- [ ] 重构素材浏览与风格选择相关界面
- [ ] 统一编辑器类页面的标题、操作区、滚动区和空态

### 验收

- [ ] 项目页不再像后台管理系统，而是 Apple 语言下的创作工作台

## Phase 8 次级模块与后台收口

### 目标

收口所有边缘模块，避免出现视觉孤岛。

### 文件

- `apps/web/src/ui/stats/**`
- `apps/web/src/ui/assets/**`
- `apps/web/src/ui/nanoComic/**`
- [`apps/web/src/ui/AgentDiagnosticsPanel.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/ui/AgentDiagnosticsPanel.tsx)
- [`apps/web/src/ui/AgentProjectContextPanel.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/ui/AgentProjectContextPanel.tsx)
- [`apps/web/src/ui/AiCharacterLibraryManagementPanel.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/ui/AiCharacterLibraryManagementPanel.tsx)

### Checklist

- [ ] 统一后台类列表和管理面板的表格、筛选、分页风格
- [ ] 统一资产页与角色库的媒体展示语法
- [ ] 统一诊断和上下文面板的容器语言
- [ ] 清理所有残留旧 token 和临时局部样式

### 验收

- [ ] 全站不存在明显视觉孤岛

## Phase 9 文档同步与最终验收

### Checklist

- [ ] 更新 `apps/web/DESIGN.md` 的实际执行映射
- [ ] 对照根目录 `Design.md` 做最终 review
- [ ] 核查首页、工作台、TaskNode、项目页是否风格统一
- [ ] 核查是否仍有 blue-cyan tech gradient、过强 glow、厚边框、多套按钮语言
- [ ] 核查 light / dark 行为是否一致且可解释
- [ ] 必要时为关键页面补截图或 review 文档

## 风险与前置提醒

- [`apps/web/src/canvas/nodes/TaskNode.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/canvas/nodes/TaskNode.tsx) 文件过大，建议视觉改造前继续拆分
- 当前存在大量局部写死颜色、圆角、阴影，Phase 1 后会集中暴露
- 若严格使用 SF 字体，需要先明确字体可用性；否则需定义可靠 fallback
- 不允许为了“兼容旧界面”保留双轨视觉体系，必须硬切换
