# TapCanvas Web Design Standard

> Current source of truth: `/Users/libiqiang/workspace/TapCanvas-pro/Design.md`
>
> 本文件不再定义独立视觉方向，只负责把根目录 `Design.md` 落成 Web 端执行基线。
> 后续做页面、组件、样式、交互时，必须先读取根目录 `Design.md`；若本文件与根目录设计稿不一致，以根目录设计稿为准。

本规范仅针对 `apps/web`，作为当前 Web 端 UI 的设计基线与评审标准。它不是灵感板，而是后续页面实现、组件封装、设计评审、视觉重构时必须对齐的执行规范。

## 1. Product Direction

TapCanvas Web 的产品形态不是营销站，也不是传统表单后台，而是一个高密度、创作型、画布型工作台。因此视觉方向必须同时满足：

- 高信息密度：同屏优先展示可操作信息，而不是大面积装饰。
- 清晰层级：复杂信息靠字号、留白、色阶和分隔表达，而不是层层卡片。
- 低摩擦操作：按钮、工具条、浮层优先短路径、少干扰、少文字。
- 专业感而非玩具感：避免过度圆润、过度糖果色、过度动效。
- 暗色优先：默认体验以 dark mode 为基线设计，light mode 为等价映射，不单独发明第二套语言。

## 2. Core Principles

- 单一视觉语法：同类组件必须共享同一套半径、间距、文字层级和阴影规则。
- 极简主义优先：视觉元素必须服务于信息与操作，不允许为了“精致感”叠加边框、描边、装饰线和额外容器。
- 单层圆角边框原则：一个独立 block 中，最多只允许一层容器同时拥有“圆角 + 可见边框”；内部层如需分组，只能使用留白、弱底色、分隔线或无圆角直角容器表达。
- 禁止“圆角套圆角”：外层容器已有圆角时，内层卡片、按钮、分组默认使用直角或极小圆角。
- 禁止为“显得精致”增加无效包裹层：能用分隔线、留白、背景色差解决的问题，不新增卡片壳。
- 边框默认克制：边框不是默认装饰语言，只有在表达边界、选中、输入焦点、错误状态时才允许出现，而且必须尽量轻。
- 文本层级优先于颜色刺激：强调信息先靠字号、字重、间距，再考虑高饱和颜色。
- 交互可见但不吵闹：hover、focus、selected 必须清楚，但不要持续闪烁、跳动、发光。
- 同一个页面中，视觉变量尽量少：半径不超过 4 档，字号不超过 7 档，阴影不超过 3 档。

## 3. Design Tokens

后续新增组件时，优先直接使用本节 token；若 token 不够，应先扩展规范，再写新值。

### 3.1 Radius

这是最需要收敛的部分。当前 Web 的问题不是“圆角太少”，而是“圆角档位太多”。

| Token | Value | 用途 |
| --- | ---: | --- |
| `radius-0` | `0px` | 内层卡片、列表项、表格行、工具条按钮、输入区内嵌块 |
| `radius-1` | `6px` | 输入框、chip、badge、小型按钮、小浮层 |
| `radius-2` | `10px` | 标准卡片、面板、下拉菜单、弹层主体 |
| `radius-3` | `14px` | 大弹窗、首页主卡、需要明显独立感的容器 |
| `radius-pill` | `999px` | 仅用于胶囊标签、计数徽标、状态点组合 |

硬规则：

- 默认使用 `radius-0` / `radius-1` / `radius-2`，禁止常态化使用 `18px`、`20px`、`24px` 这类松散值。
- 一个 block 中只允许一层使用带边框圆角容器；若外层已有圆角边框，内层必须去边框、去圆角或二者同时去掉。
- 一个组件内部如果外层已经是 `radius-2` 或 `radius-3`，内层内容块默认回落到 `radius-0` 或 `radius-1`。
- `radius-pill` 只给 badge/tag/status，不给面板、输入框、弹窗、卡片。
- React Flow 节点、画布浮层、侧边面板统一按“外层 10 / 内层 0~6”处理，不做软糖式圆角。

推荐 Mantine 映射：

- `xs -> 6px`
- `sm -> 10px`
- `md -> 14px`
- 禁止随手使用 `lg/xl` 作为默认业务半径

### 3.2 Typography

字体目标不是“好看”，而是高密度场景下稳定、可扫读、可连续工作。

主字体栈：

```txt
Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
```

等宽字体栈：

```txt
ui-monospace, "SFMono-Regular", Menlo, Monaco, Consolas, monospace
```

字号层级：

| Token | Size / Line | Weight | 用途 |
| --- | --- | --- | --- |
| `text-hero` | `32 / 38` | `700` | 落地页极少数主标题；工作台内部默认禁用 |
| `text-h1` | `24 / 30` | `700` | 页面主标题 |
| `text-h2` | `20 / 26` | `650` | 模块标题、主面板标题 |
| `text-h3` | `16 / 22` | `650` | 卡片标题、弹层标题、区块标题 |
| `text-body` | `14 / 20` | `500` | 默认正文、表单、列表、按钮文字 |
| `text-body-sm` | `13 / 18` | `500` | 次级说明、辅助信息 |
| `text-caption` | `12 / 16` | `500` | meta、标签、状态说明、表头辅助文案 |
| `text-micro` | `11 / 14` | `600` | 极小型状态字、时间戳、角标；谨慎使用 |

字重规则：

- `700` 只给页面级或强标题。
- `650/600` 用于模块标题、标签、按钮强调。
- `500` 是正文默认值。
- 避免大面积 `400`，在暗色、高密度界面里会显得发虚。

字距规则：

- 中文正文默认 `0`。
- 英文全大写标签允许 `0.06em ~ 0.08em`。
- 大标题可使用 `-0.02em ~ -0.03em`，正文禁止负字距。

### 3.3 Spacing

统一采用 4pt 栅格，避免 `7px`、`10px`、`18px` 这种偶发值。

| Token | Value | 用途 |
| --- | ---: | --- |
| `space-1` | `4px` | 图标和文字微间距 |
| `space-2` | `8px` | 表单项内间距、小按钮间距 |
| `space-3` | `12px` | 卡片内小区块、列表项内容间距 |
| `space-4` | `16px` | 标准组件 padding、模块内部间距 |
| `space-5` | `20px` | 中型面板间距 |
| `space-6` | `24px` | 页面区块间距 |
| `space-8` | `32px` | 大区块分隔 |
| `space-10` | `40px` | 首页或大型内容段落分隔 |

硬规则：

- 组件默认 padding 从 `12 / 16 / 20` 三档里选，避免任意数值漂移。
- 表单行高优先紧凑：输入区高度不靠巨大 padding 撑开。
- 画布浮层、下拉、侧栏的内容密度应明显高于营销页。

### 3.4 Color Roles

颜色不按“页面心情”自由发挥，只按角色分配。

基础色角色：

- `bg.app`：应用最底层背景
- `bg.surface`：主面板/主卡背景
- `bg.subtle`：弱分组、hover、次级容器
- `bg.strong`：重点区域、选中区、强调块
- `fg.primary`：主文本
- `fg.secondary`：次文本
- `fg.tertiary`：弱信息/占位
- `border.subtle`：默认分隔
- `border.strong`：选中、focus、关键轮廓
- `accent.primary`：主强调色
- `accent.success` / `warning` / `danger` / `info`：语义色

执行标准：

- 主强调色维持冷色系蓝青方向，不引入紫色作为默认品牌主色。
- 语义色只用于语义，不用于装饰。
- 暗色模式下优先通过明度差异拉层级，不靠高透明白蒙层堆“玻璃感”。
- Light mode 是 dark mode 的值域映射，不是另一种产品风格。

建议值域：

- 主文本对比度：`>= 4.5:1`
- 次文本对比度：`>= 3:1`
- 分隔边框透明度：优先 `6% ~ 14%`
- Hover 态填充：优先 `4% ~ 8%`

### 3.5 Shadows And Blur

当前产品可以保留少量玻璃感，但必须克制，尤其是画布热路径上的性能成本。

| Token | Value | 用途 |
| --- | --- | --- |
| `shadow-1` | 轻阴影 | 下拉、轻浮层、按钮悬停 |
| `shadow-2` | 中阴影 | 标准卡片、侧栏、控制面板 |
| `shadow-3` | 强阴影 | Modal、全局浮层、关键悬浮面板 |

硬规则：

- 单个页面最多同时出现两档阴影。
- `backdrop-filter` 只给少数浮层，不给批量列表、节点网格、滚动容器。
- 节点、画布控制器、悬浮工具条在拖拽/缩放热路径上必须可降级为无 blur、低 shadow。

### 3.5.1 Dark-Only Token Table

当前 dark mode 的专用语义 token 统一如下，新增样式不得再临时发明新的主表面色系：

| Role | Token | Value |
| --- | --- | --- |
| App background | `--tc-color-app-bg` | `#05070b` |
| App background strong | `--tc-color-app-bg-strong` | `#020409` |
| Primary surface | `--tc-color-surface` | `#0b0f14` |
| Raised surface | `--tc-color-surface-raised` | `#10161d` |
| Subtle grouped surface | `--tc-color-surface-subtle` | `#131a22` |
| Inline block surface | `--tc-color-surface-inline` | `rgba(255, 255, 255, 0.035)` |
| Subtle border | `--tc-color-border-subtle` | `rgba(226, 232, 240, 0.08)` |
| Strong border / focus | `--tc-color-border-strong` | `rgba(125, 211, 252, 0.24)` |
| Primary text | `--tc-color-text-primary` | `#edf3ff` |
| Secondary text | `--tc-color-text-secondary` | `#aab7ca` |
| Tertiary text | `--tc-color-text-tertiary` | `#73839a` |
| Accent blue | `--tc-color-accent-blue` | `#60a5fa` |
| Accent cyan | `--tc-color-accent-cyan` | `#22d3ee` |
| Success | `--tc-color-success` | `#34d399` |
| Warning | `--tc-color-warning` | `#fbbf24` |
| Danger | `--tc-color-danger` | `#f87171` |
| Info | `--tc-color-info` | `#38bdf8` |

执行规则：

- 主表面统一落在 `surface / surface-raised / surface-inline` 三层，不再用偏灰玻璃色做第四层视觉体系。
- 内嵌信息块统一优先用 `surface-inline`，不要单独再画小边框卡。
- 强调使用蓝青冷色点到即止，不允许大面积紫色、粉色或高饱和玻璃发光。

### 3.6 Motion

- 默认动效时长：`120ms / 160ms / 220ms`
- 默认 easing：`ease` 或 `cubic-bezier(0.2, 0, 0, 1)`
- hover 只做透明度、背景、边框、阴影的轻变化
- 禁止使用弹簧感过强的“玩具型”过渡
- 页面级进入动效必须稀少，工作台核心操作以稳定为先

## 4. Component Standards

这一节是组件级的设计契约。基础 token 解决“用什么值”，组件规范解决“这个组件到底应该怎么长、怎么用、什么不能做”。

### 4.1 Button

按钮分成 4 类，不允许自由发明第 5 类：

| 类型 | 高度 | 半径 | 用途 |
| --- | ---: | ---: | --- |
| `button-primary` | `36px` | `6px` | 页面主提交、关键创建、关键确认 |
| `button-secondary` | `32px` or `36px` | `6px` | 次级动作、常规执行 |
| `button-subtle` | `32px` | `6px` or `0px` | 工具栏、弱操作、行内操作 |
| `button-icon` | `28px` or `32px` | `0px` or `6px` | 画布工具、面板操作、列表快捷动作 |

规则：

- 同一个操作区只能有一个 `button-primary`。
- 主按钮优先用实底，不做 outline 主按钮。
- 次按钮可以是弱底色或轻 outline，但边框必须轻，不允许厚描边。
- icon-only 按钮必须有 `aria-label`，悬停时优先提供 tooltip。
- 工具栏按钮默认不用大圆角；外层工具栏已圆角时，内部按钮优先 `0px`。
- destructive action 默认不做实心大红按钮，优先 subtle / outline + 明确确认。

禁用项：

- 禁止使用超大圆角主按钮。
- 禁止按钮文字、图标、阴影、背景同时都很重。
- 禁止在同一组按钮内混用 3 种以上视觉风格。

### 4.1.1 Base Action Components

- `PanelCard`：唯一允许承担“外层圆角 + 可见边框”的通用面板壳。
- `InlinePanel`：内部信息块，无边框、直角或近似直角。
- `IconActionButton`：统一 icon-only 操作语法，默认 `radius-1`，不可再发明大圆角工具按钮。
- `StatusBadge`：统一状态标签语法，仅用作短状态/meta，不承担容器职责。
- `StatePanel`：统一空状态 / 错误态 / 加载态信息块语法，默认基于 `InlinePanel` 表达。

### 4.2 Input / Textarea / NumberInput

默认规格：

| 组件 | 高度 | 半径 | 文本 |
| --- | ---: | ---: | --- |
| `text-input` | `36px` | `6px` | `14px` |
| `compact-input` | `32px` | `6px` | `13px` |
| `textarea` | `>= 72px` | `6px` | `14px` |
| `number-input` | `36px` | `6px` | `14px` |

结构规则：

- label 使用 `12px` 或 `13px`，字重 `600`。
- description / hint 使用 `12px`，颜色为 `fg.secondary`。
- placeholder 使用 `fg.tertiary`，不允许过亮。
- 输入内容区优先深浅背景差 + 细边框，不要靠大阴影。
- 文本域默认可垂直扩展，但初始高度要克制。

状态规则：

- `default`：弱边框 + 清晰文本对比
- `hover`：边框或背景轻微增强
- `focus`：必须有明显 focus ring 或边框增强
- `error`：边框变语义色 + 辅助文案，不整块铺红底
- `disabled`：降低对比度，但仍可读

禁用项：

- 禁止不同输入组件出现完全不同的高度体系。
- 禁止把 label 做成大正文。
- 禁止 error 态只改文字不改输入框本体。

### 4.3 Select / MultiSelect / SegmentedControl / Tabs

这是选择器家族，必须按交互复杂度选型，而不是哪个顺手就用哪个。

选择规则：

- `SegmentedControl`：2 到 4 个强对立选项，且用户需要快速切换。
- `Tabs`：内容区切换，保留上下文，不用于纯筛选。
- `Select`：单选，选项较多，允许搜索。
- `MultiSelect`：多选且需要显式查看已选项。
- `Menu`：临时动作集合，不承载长期状态。

默认规格：

| 组件 | 高度 | 半径 | 场景 |
| --- | ---: | ---: | --- |
| `select` | `36px` | `6px` | 标准表单 |
| `compact-select` | `32px` | `6px` | 工具栏、面板头部 |
| `segmented-control` | `32px` | `10px` 外层 / `6px` 内项 | 轻量切换 |
| `tabs-list` | `32px` or `36px` | `0px` or `10px` 外层 | 页面结构切换 |

Tabs 规则：

- 页面主 tabs：更像信息架构，不像按钮组。
- Tab label 默认 `13px ~ 14px`，字重 `600`。
- 激活态优先靠底色、文字和下边界或轻轮廓表达。
- 不做夸张胶囊 tabs，除非在纯营销页。

SegmentedControl 规则：

- 外层容器可以 `radius-2`
- 内部 item 必须收敛到 `radius-1`
- 文字要短，最多两词

### 4.4 Card / Paper / Section Panel

Card 是“信息块”，不是万能外壳。

标准规格：

| 类型 | 半径 | Padding | 说明 |
| --- | ---: | ---: | --- |
| `panel-card` | `10px` | `16px` | 标准业务面板 |
| `compact-card` | `10px` | `12px` | 列表、表单辅助块 |
| `hero-panel` | `14px` | `20px` | 首页主卡、重要总览卡 |

结构模板：

1. `header`
2. `meta/actions`
3. `content`
4. `footer`（可选）

规则：

- 一个 Card/Panel block 中，只有最外层允许同时拥有圆角和边框；内部 section 禁止再次使用同等级圆角边框壳。
- Card 内部如需再分组，优先用分隔线、背景差和间距，而不是再套 `Paper/Card`。
- Card 标题默认 `16px`，正文默认 `14px`。
- Card 顶部操作区应右对齐或自然跟随标题，不在视觉上与标题抢主次。
- 数据卡里的主要数字允许 `20px` 或 `24px`，但辅助信息必须明显收住。

禁用项：

- 禁止 `Card` 里面再套多个 `withBorder + radius` 的 `Paper/Card` 作为常规结构。
- 禁止为了区分内容层级，把每个小模块都画成独立圆角小卡片。

### 4.5 Modal / Drawer / Popover / Menu / Tooltip

浮层类组件必须区分“承载任务”和“提供提示”。

Modal 规则：

- 主容器半径 `14px`
- 内边距优先 `20px`
- 标题使用 `16px`
- 底部操作区固定为“取消在左，主操作在右”或“弱操作在前，主操作在后”
- 多步骤 Modal 不要在一个弹窗里塞太多层级
- Modal 内部内容分组默认不用第二层圆角边框卡片，优先靠标题、间距、分隔处理

Drawer 规则：

- 贴边 Drawer 优先 `0px`
- 浮起式 Drawer 可用 `10px`
- Drawer 适合连续编辑，不适合破坏式确认

Popover / Menu 规则：

- 半径 `10px`
- Menu item 高度 `30px ~ 34px`
- item 默认 `13px`
- 支持图标时，图标区宽度固定，避免文字跳动
- destructive item 放在底部或分组后，不与普通项混排

Tooltip 规则：

- Tooltip 只解释，不承担关键流程信息
- 文案保持单行优先，超长时截断或改用 Popover
- Tooltip 出现延迟建议 `120ms ~ 180ms`

### 4.6 Badge / Tag / Status Chip

状态型组件必须统一，不允许每个页面自己捏一套小胶囊。

标准规格：

| 类型 | 高度 | 半径 | 文本 |
| --- | ---: | ---: | --- |
| `status-badge` | `20px` | `999px` | `12px / 600` |
| `tag-chip` | `22px ~ 24px` | `999px` | `12px / 500` |
| `count-pill` | `18px ~ 20px` | `999px` | `11px / 700` |

规则：

- 状态 badge 最多展示一个主状态词。
- Tag 负责分类，不负责解释业务逻辑。
- 同一容器里 badge 不超过 3 枚；超过时必须折叠或摘要。
- badge 的颜色语义固定，不允许同一状态一会儿蓝一会儿绿。

### 4.7 Table / List / Row Item

高密度工作台里，列表的规范比单卡片更重要。

表格规则：

- 行高优先 `40px`，紧凑场景可到 `36px`
- 表头 `12px / 600`
- 单元格正文 `13px` 或 `14px`
- 数字列右对齐，状态列宽度尽量固定
- 操作列默认 icon-only 或短按钮

列表规则：

- 行项 hover 使用 `bg.subtle`
- 选中态用边框、背景或左侧标记，不直接整行高饱和着色
- 标题 + 副标题列表：标题 `14px`，副标题 `12px~13px`
- 长文本优先截断，详情进二级面板或 tooltip

### 4.8 Empty / Loading / Error States

这三类状态必须统一，否则产品会显得像拼接出来的。

Empty State：

- 一个图标或插画 + 一个短标题 + 一句说明 + 一个主动作
- 标题 `16px`
- 说明 `13px`
- 不写大段教程式空文案

Loading State：

- 局部加载优先 skeleton / spinner + 原地保留布局
- 页面级加载才允许居中 loader
- loading 文案只说明当前动作，不写安抚性废话

Error State：

- 错误标题 + 简明原因 + 可执行的下一步
- 禁止只有“失败了，请重试”
- 允许展示技术细节，但要折叠或分层展示

### 4.9 Notification / Alert

Toast / Notification：

- 只用于轻反馈：成功、失败、已保存、复制完成
- 默认停留短，不连续轰炸
- 成功 toast 比错误 toast 更轻
- 不能拿 toast 替代表单内错误提示

Alert / Inline Notice：

- 用于页面内持续存在的提醒
- 标题 `13px ~ 14px / 600`
- 正文 `12px ~ 13px`
- 默认半径 `10px`
- 语义色做辅助，不占满视觉主导权

### 4.10 Canvas-Specific Rules

这是 Web 端最特殊的部分，必须单独约束。

节点外壳：

- React Flow 节点外壳统一建议 `radius-2`
- 节点 header / toolbar / config strip 优先 `radius-0`
- 节点内部媒体预览、工具条、表单块优先 `radius-0` 或 `radius-1`
- 节点 padding 优先 `12px`
- 一个节点 block 中，只允许最外层节点壳保留圆角边框；节点内部的区块、预览格、参数分组不得再叠加同级圆角边框

节点工具条：

- 默认 icon-only
- 按钮高度 `28px`
- hover 清楚，默认态要克制
- 常驻按钮数量尽量少，其余进菜单

画布浮层：

- 浮动控制器、缩放控件、快速工具条统一 `radius-2`
- 浮层内容区 item 高度与全站 menu 统一，不另起一套
- 选中态优先使用边框、外发光、阴影变化，不扩大组件尺寸
- 生成中状态优先通过遮罩、进度、状态点表达，不要引入大面积复杂动画

性能约束：

- 节点列表、缩略图、参考条带、批量浮层不能依赖大面积 blur
- 画布上的信息卡必须比后台页面更克制，因为同屏数量更多

## 5. Density Rules

TapCanvas 不是“呼吸感优先”的产品，密度标准必须明确：

- 桌面端标准面板内容宽度内，默认使用 `14px` 正文，不使用 `16px` 正文作为常态
- 一个标准信息卡中，标题与内容之间默认 `8px`，段与段之间默认 `12px`
- 页面主区块之间优先 `24px`，不是 `40px+`
- 可图标化的次级操作，默认不再额外放文字按钮
- 辅助说明文案只有在会直接降低误操作时才保留

## 6. Accessibility Standard

- 主文本和交互控件必须满足基本对比度要求
- 所有 icon-only 按钮必须有 `aria-label`
- 交互焦点必须可见，不得只保留 hover 样式
- 文本层级不能只靠颜色区分，必须同时有字号或字重差异
- 不允许把关键提示信息只放在 tooltip 中

## 7. Implementation Rules

后续代码实现必须遵循：

- 优先通过全局 design token 驱动，而不是组件内部写死魔法值
- Mantine `radius`、`spacing`、`fontSizes` 应收敛到本规范，不继续扩散 `md/lg/xl` 的随意使用
- 自定义 CSS 中出现新尺寸前，先判断能否复用既有 token
- 如需新增边框，必须先回答“这条边框是否真的承担边界/状态表达职责”；如果只是装饰，禁止添加
- 如需在一个 block 内新增第二层圆角边框，默认视为设计违规，除非用户明确批准
- 评审时，若一个页面新增超过 2 个未定义尺寸值，应视为设计系统违规

建议后续工程化落地方向：

1. 在 `apps/web/src` 建立统一 theme token 文件，映射半径、间距、字号、阴影。
2. 在 `MantineProvider` 中显式定义 `radius`、`fontSizes`、`headings`、`spacing`。
3. 对高频组件封装基础壳层，例如 `PanelCard`、`SectionHeader`、`IconActionButton`。
4. 清理现有手写 `border-radius: 16/18/24px` 和随意字号。

## 8. Review Checklist

做页面或组件评审时，按这份清单卡：

- 是否出现未定义圆角值？
- 是否出现一个 block 内多层“圆角 + 边框”容器？
- 是否存在圆角套圆角？
- 是否添加了只会转移注意力的装饰性边框？
- 是否用额外包裹层掩盖层级不清？
- 是否正文默认字号超过 `14px` 导致密度下降？
- 是否同一屏里混入过多字重、字号、阴影档位？
- 是否把次级动作做得比主动作还醒目？
- 是否用了高成本 blur / shadow 却没有足够价值？
- 是否只靠颜色区分信息层级？
- 是否有 icon 按钮缺少 tooltip 或 `aria-label`？

## 9. Current Standard Summary

如果只记最核心的几条，记这组默认值：

- 页面正文：`14px / 20px`
- 次级说明：`13px / 18px`
- 卡片标题：`16px / 22px`
- 输入/按钮默认半径：`6px`
- 标准卡片/面板半径：`10px`
- 大弹层半径：`14px`
- 组件 padding：优先 `12px / 16px / 20px`
- 页面区块间距：优先 `24px`
- 胶囊 badge：唯一允许 `999px`

这就是 `apps/web` 后续默认设计语法。新增页面先遵守，再谈特例。
