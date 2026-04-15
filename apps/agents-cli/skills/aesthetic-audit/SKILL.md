---
name: aesthetic-audit
description: 商业级视觉资产与网页(详情页/落地页)的审美与UX视觉审查：输出P0/P1/P2问题清单、可落地的样式tokens与改稿建议；可结合截图、URL与源码进行定位与修改。
---

# Aesthetic Audit (Commercial)

该 skill 用于“审美判断”在商业项目中的落地：
- 不是泛泛而谈“好不好看”，而是将审美转化为可执行的改动：信息层级、栅格与间距系统、字体层级、色彩与对比度、组件一致性、CTA 可见性、移动端适配、信任要素。
- 默认以 **转化/可用性/品牌一致性/可维护性** 为目标约束。

适用输入：
- 视觉资产图：主视觉/卖点图/细节图/规格图（单张或整套）
- 网页：URL（可本地/线上）或桌面/移动端截图
- 源码：页面路由 + 组件/样式文件（React/Next/Vue/Vite/Tailwind/SCSS/CSS-in-JS 等均可）

输出交付（强制结构）：
1) 一句话结论（页面意图 + 当前最大问题）
2) P0/P1/P2 问题清单（现象-影响-原因假设-修改建议）
3) 样式 tokens（可落地的字体/间距/色彩/圆角/阴影/栅格）
4) Quick wins（3-7 条不大改结构、立刻提升质感/转化的改法）
5) 若提供源码：改动建议落地到文件路径（或直接修改）+ 验证步骤

---

## 审查原则 (Commercial Aesthetics)

优先级从高到低：
- **清晰度**：3 秒内用户能否看懂“卖什么/给谁/最大利益/下一步做什么”
- **层级**：标题/副标题/正文/注释/参数/CTA 的视觉权重是否正确
- **一致性**：栅格、间距、字体、颜色、圆角、阴影、icon、图片色调是否成体系
- **信任**：证据链是否完整（对比/数据/口碑/保障/资质/售后）且表达克制
- **效率**：减少认知负担；移动端首屏与滚动节奏合理
- **可访问性**：对比度、字号、点击热区、键盘/读屏基础

反模式（看到就优先修）：
- 同一层级文本用不同字号/字重/颜色
- 间距无规律（到处是 17/23/29 这类魔法数）
- 过多强调手段叠加（颜色+加粗+描边+阴影+动画）
- CTA 不突出或被装饰/次要信息抢权重
- 证据表达过度“像P图/像假数据”，导致信任下降

---

## 审查流程

### A. 网页（有 URL）
1) 先获取 **桌面/移动** 的首屏与全页视图
2) 只基于渲染结果做第一轮审查（避免被实现细节带偏）
3) 再结合源码定位：组件边界、布局系统、tokens来源、断点策略

推荐视口：
- Desktop: 1440x900 (fold) + full page
- Mobile: 390x844 (fold) + full page

### B. 只有截图/图片
1) 按“信息层级/对齐栅格/间距节奏/字体/颜色/证据链/移动端”逐项检查
2) 输出 tokens + Quick wins
3) 如需落地，要求用户提供对应页面/组件路径

### C. 有源码（需要落地改）
1) 先找页面入口：route -> page component -> section components
2) 找样式入口：global css/tailwind config/theme tokens/component css
3) 小步改：先建立 tokens，再做版式/组件一致性
4) 验证：桌面/移动、长文案/短文案、极端数据、加载状态

---

## 输出模板 (Must Follow)

### 1) 一句话结论
- 这页在卖/表达：...
- 当前最大问题：...（一句话）

### 2) P0 / P1 / P2
每条必须用同一格式：
- 现象：
- 影响：
- 原因假设：
- 修改建议（可执行）：

P0：直接影响“看懂/信任/CTA/移动端可用性”
P1：影响质感、一致性、阅读效率
P2：细节优化（微交互、细节对齐、边界情况）

### 3) Tokens 建议（落地优先）
给出一套可直接映射到 CSS variables / Tailwind theme 的 tokens：
- Typography: H1/H2/H3/Body/Caption 的 font-size, line-height, font-weight
- Spacing scale: 4/8/12/16/24/32/48/64/96 (不要碎值)
- Grid: max width, gutter, breakpoints
- Color: bg/surface/text/muted/border/brand/accent/success/warn/danger
- Radius: 8/12/16
- Shadow: 1-2 档（轻）

### 4) Quick wins
- 3-7 条，必须是“不大改结构但效果立竿见影”的改法

### 5) 落地到代码（若有）
- 修改哪些文件：`path/to/file`
- 关键改动点：
- 如何验证：命令 + 检查点（桌面/移动/断点/状态）

---

## 视觉资产图专用检查清单

- 主体占比：70-85%（主图常用）
- 文案长度：标题 <= 12-16 字；副文案 <= 24 字；避免长段
- 证据表达：参数/测试/认证需“可核验”；图表 2 色 + 1 强调色
- 风格一致：光向、阴影、反射、色温、背景材质统一
- 留白：边距一致（不贴边），避免四周塞满字

---

## 工具使用建议

- 优先：用户直接给截图/图片（信息最确定）
- 若只有 URL：
  - 可用 Playwright CLI 获取截图（无头浏览器）
  - 然后再做审查

Playwright 截图示例（仅作参考）：
```bash
npx -y playwright screenshot --browser chromium --full-page \
  "http://localhost:5173/?projectId=..." artifacts/audit/desktop-full.png

npx -y playwright screenshot --browser chromium --viewport-size=390,844 --full-page \
  "http://localhost:5173/?projectId=..." artifacts/audit/mobile-full.png
```

注意：视觉判断不要臆测未出现的品牌/资质/数据；不确定要标注。
