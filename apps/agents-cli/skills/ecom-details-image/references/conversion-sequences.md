# 转化序列与信息图结构

商品主图、电商图、广告图和 PDP 视觉不要从图型清单开始，先从**转化驱动力**开始。

## 转化驱动力三型

先选一个主要驱动力，再决定画面顺序。

### A. 视觉驱动型

适用于购买决策依赖外观、风格匹配、光洁度、质感、前后对比或礼品属性的产品。

重点：一眼抓住产品吸引力；质感、细节、工艺与质量信号；使用场景与视觉层级；简短利益点。

### B. 痛点驱动型

适用于买家有明确摩擦、风险、时间损失、不适或反复烦恼的产品。**顺序强制**：

1. 痛点挖掘 / 风险触发
2. 利益 / 解决方案
3. 信任与证明
4. 优惠 + CTA

重点是具体问题、缓解机制、证据与风险逆转。

### C. 情感价值驱动型

适用于购买与身份、信心、归属、地位、关怀、快乐、新奇或冲动相关的产品。

重点：情绪钩子；身份或向往；产品作为实现方式；社交证明与低摩擦行动。

## 主图序列

### 视觉驱动型

1. 一眼可懂的视觉主张
2. 核心功能或质感特写
3. 使用场景匹配
4. 普通方案 vs 升级方案对比
5. 优惠、物流、保障或 CTA 画面

### 痛点驱动型

1. 问题快照
2. 解决机制
3. 利益证明
4. 信任画面
5. 优惠 + 紧迫 CTA

### 情感价值驱动型

1. 情绪场景钩子
2. 身份 / 价值表达
3. 产品作为实现方式
4. 归属、地位或社交信号
5. 带情绪强化的优惠 + CTA

## 详情页图片序列

详情页用于移动端纵向浏览，每张独立成屏，比例优先 `2:3` 或平台指定竖版。除非用户明确只要文案，每个模块都要输出对应图片 prompt。

1. **首屏承接**：延续主图卖点，说明产品为谁解决什么问题。
2. **痛点放大**：展示当前的不便、损失、风险或反复烦恼。
3. **机制解释**：用视觉化结构说明产品如何起作用；不得虚构无法证明的数据。
4. **核心利益**：把 2-4 个主要利益做成易扫读的信息图。
5. **使用步骤**：3-4 步说明怎么用，降低理解成本。
6. **场景覆盖**：典型使用场景、适用对象或使用前后状态。
7. **对比选择**：普通方案 vs 本产品，突出可观察差异。
8. **信任背书**：材料、包装、质检、保障、真实评价等**已有证据**；没有证据就写 `proof placeholder`，不要编造认证。
9. **FAQ / 风险逆转 / CTA**：处理残留疑虑、适用范围、售后与组合优惠。

### 按驱动力适配

- 视觉驱动型：增加质感细节、尺寸比例、使用场景与礼品感。
- 痛点驱动型：严格按“问题严重性 → 解决机制 → 利益证明 → 信任 → CTA”推进。
- 情感价值驱动型：增加生活方式、身份表达、社交场景与情绪回报。

## 图片内文字规则

- 每屏主标题 3-7 个英文词或 6-12 个中文字；说明性文字用 2-4 个短标签；每区文字总量控制在 50 字以内。
- 中文字用「」包裹（如「修护屏障」「72h 深层锁水」），渲染准确率明显更高。
- 指定字号：标题 28-48pt，副标题 16-20pt，标注 10-14pt。
- 颜色用 hex：深灰标题 `#2D2D2D`，浅灰标注 `#888888`，金色强调 `#D4AF37`。
- 模型容易出乱码时，prompt 明确要求 `clean layout with short readable headline placeholders, no dense body text`。
- 出图后必须放大 200% 逐字核对中文笔画，复杂字（赢、鬱、餮等）换简单同义字。

## 视觉节奏（多图任务）

连续多张的背景色不能完全一样，否则视觉疲劳。交替使用 2-3 种：

- 白底主图 / 卖点副图：`#FFFFFF`
- 成分解析 / 质地展示：`#F5F1E8`（浅米色）
- 品牌主视觉 / 促销图：品牌深色（如 `#1A3A2E`）

## 多角度与景别分配

**全套图绝不能全用同一角度。** 模型默认倾向正面 3/4 角，不显式指定就会千篇一律。

### 角度清单（按用途选 4-6 种）

| 角度 | Prompt 写法 | 适用 |
|---|---|---|
| 正面 3/4 | `at a slight 3/4 angle showing full front facade` | 主图、首图 |
| 正上方俯视 | `photographed directly from above at a 90-degree overhead angle` | 布局、内部结构、平铺 |
| 侧面 90° | `photographed from a clean 90-degree side profile` | 深度、层次、侧面细节 |
| 后侧 45° | `photographed from behind at a 45-degree rear angle` | 背面细节、尾部构造 |
| 仰视低角度 | `photographed from a very low angle looking upward` | 英雄镜头、气势感 |
| 高角度俯视 | `photographed from a high 45-degree angle looking down` | 顶部、整体规模、桌面视角 |

### 景别清单（按用途选 2-3 种）

| 景别 | Prompt 写法 | 适用 |
|---|---|---|
| 全景 | `full product visible, product occupies 35-40%` | 主图、场景图 |
| 中景 | `showing the [section name] area, product occupies 45-50%` | 功能展示、结构说明 |
| 特写 | `tight zoom on [specific detail], product detail occupies 55-60%` | 材质、工艺、按钮接口 |
| 微距 | `extreme close-up macro shot, shallow depth of field` | 面料编织、接缝、表面纹理 |
| 局部 | `close-up detail shot focusing on [specific part]` | 拉链、标签、局部构件 |

### 分配原则

1. 主图序列（5 张）至少 3 种角度，其中 1 张必须是特写或微距。
2. 详情页序列（7-9 张）至少 4 种角度，其中 2 张必须是特写/微距。
3. 不能连续 3 张使用相同角度。
4. 全景不超过整套的 40%，必须穿插中景、特写与微距。
5. 仰视与俯视各至少 1 张。
6. 每张 prompt 必须显式写角度关键词，不要假设模型会自动变换角度。

### 角度 prompt 模板

嵌入每张 prompt 的「构图、镜头和取景」段：

```text
# 俯视
Bird's eye top-down view. The [product] photographed directly from above at a 90-degree overhead angle, showing the full layout [details visible from above]. Deep even lighting from directly above minimizing shadows.

# 侧面
Side profile view. The [product] photographed from a clean 90-degree side profile, showing [what's visible from side]. Strong side lighting from the left creating dramatic depth.

# 仰视
Dramatic low-angle hero shot. The [product] photographed from a very low angle looking upward, making [structure] appear tall and imposing. Strong upward lighting creating heroic dramatic shadows.

# 微距特写
Extreme close-up macro shot. Tight zoom on the [specific detail], showing [texture/mechanism/elements]. Shallow depth of field with the foreground in sharp focus and background slightly blurred. Warm directional side lighting highlighting surface texture.

# 后侧
Rear angled view. The [product] photographed from behind at a 45-degree rear angle, revealing [back details not visible from front].
```

## 详情页信息图结构（关键）

**详情页图片 ≠ 多角度产品照片。** 详情页必须是电商信息图：含卖点文案、图标、标签、对比、步骤、信任徽章；产品在不同信息图中展示不同角度。多角度是为信息图服务的展示手段，不是目的。

### 错误做法

```text
Prompt: Side profile view of the product on white background. Product occupies 38%. Whitespace 50%+.
```

这只是“同一产品换个角度拍”，缺少电商转化元素。

### 正确做法

```text
E-commerce infographic benefits screen on #FAF7F2 background.
Top headline in #2D2D2D at 28pt reading 「Core Benefits」.
Left side: the product shown from an elevated overhead angle.
Right side: four benefit rows stacked vertically with thin-line icons:
  (1) icon + 「Feature One」 in #7A9E7E
  (2) icon + 「Feature Two」 in #8B6F47
  (3) icon + 「Feature Three」 in #7A9E7E
  (4) icon + 「Feature Four」 in #8B6F47
Clean two-column layout. Product occupies 35%. Whitespace 48%+.
```

### 每屏必须包含的信息图元素

| 屏幕 | 电商结构 | 信息图元素 | 产品角度建议 |
|---|---|---|---|
| 首屏承接 | 标题 + 产品 + 4 个特色图标 + 副标题 | 图标+标签环绕产品 | Front 3/4 |
| 痛点对比 | 3 个痛点图标 → 3 个解决方案 + 产品 | 上下对比布局 | Side profile |
| 核心特色 | 多栏并列 + 每栏标签与描述 | 网格/三栏布局 | 各元素独立特写 |
| 核心利益 | 左产品 + 右利益列表（图标+短文案） | 双栏信息图 | Elevated overhead |
| 使用步骤 | 4 步时间线/编号圆 + 最终成品 | 步骤流程图 | Low-angle（最终效果） |
| 场景覆盖 | 3 个场景照片 + 场景标签 | 三行场景卡 | 不同使用环境 |
| 信任/工艺 | 微距细节图 + 标注圆 + 信任徽章 | 细节标注图 | Macro 特写 |
| CTA/礼品 | 标题 + 产品 + 卖点徽章 + CTA 按钮 | 转化闭合布局 | Front 3/4 |

### 信息图 prompt 必须包含

1. **布局关键词**：`e-commerce infographic`、`structured grid layout`、`two-column layout`、`three-row layout`、`timeline`、`comparison layout`
2. **标题与文案**：`headline in #2D2D2D at 28pt reading 「...」`、`label in #7A9E7E at 14pt reading 「...」`
3. **信息图元素**：`feature callout icons`、`thin connecting lines`、`numbered circles`、`trust badges`、`CTA button placeholder`
4. **产品角度**：每张信息图内产品角度不同，但角度服务于信息图内容
5. **开头固定**：每张详情页 prompt 以 `E-commerce infographic [screen type]` 开头，而不是 `Close-up shot` 或 `Side view`

## 字体搭配

- 主标题用衬线体（如 Didot），副标题与正文用无衬线体（如 SF Pro Display）。
- 这是奢侈品画册的标准组合，高级感强。
- 整套图只用这 2 种字体，禁止混用第三种。
