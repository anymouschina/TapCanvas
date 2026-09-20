---
name: ecom-details-image
description: 电商商品静图与详情页视觉的方法论 Skill。覆盖白底主图、场景生活图、平铺、微距细节、促销海报/Banner、社媒素材、UGC 买家秀、模特展示、前后对比、包装礼盒、信息图、尺寸规格、套装组合、直播间、虚拟试穿、爆炸拆解、隐形模特、多角度网格、杂志大片、季节 campaign、奢华氛围、设备 mockup、门店空间、运动广告共 25 个场景方向。把产品事实与卖点编译为可执行的 GPT-Image-2 提示词、多图 Campaign Style Lock 与主图/详情页图片包；用户明确要求出图时沿 TapCanvas 自有生图链路真实产出资产，不直连外部模型 API、不需要任何外部 key。
disable-model-invocation: false
category: 视觉创作
consumes:
  - 产品事实、卖点、受众、投放平台与画幅要求
  - 用户提供的产品参考图（以当前授权作用域内的节点 ID 或资产 ID 表达）
  - 已有品牌规范、项目画风锚或已批准素材（可选）
produces:
  - 单张图片的最终 prompt 与具体否定清单
  - 多图任务的 Campaign Style Lock
  - 主图/详情页图片包计划（编号、用途、画幅、场景方向、短文案）
  - 用户明确要求出图时的真实图片节点与资产回执
required-evidence:
  - 引用的产品参考图节点/资产 ID 来自当前授权作用域与真实工具结果
  - 认证、实验数据、评分、销量、评价与品牌授权必须有可核验来源，否则只能写成占位
  - 出图完成声明依据成功媒体回执与最终节点状态，而不是提示词已提交
side-effects:
  - 仅在用户明确要求出图时调用现有生图工具创建资产；不覆盖已有结果、不修改项目全局画风
related-skills:
  - tapcanvas-api
  - gpt-image-2-gen
  - xhs-cover-anchor
  - tapcanvas-style-pack
  - tvc-ad-director
  - mixed-media-image
self-check:
  - 颜色写 hex、产品占比与留白写数字、结尾有具体否定清单
  - 多图任务每张 prompt 复用同一段 Campaign Style Lock，未改写、缩短或换同义词
  - 详情页 prompt 是电商信息图结构，不是换角度的产品照
  - 证据缺失处写成占位，没有编造认证、数据、评价或授权
  - 用户要真实图片时不以提示词包、计划或“已受理”代替资产完成
---

# 电商商品与详情页视觉

这个 Skill 解决的是**转化问题**，不是审美问题。商品图的成败由「买家 3 秒内是否看懂这是什么、为什么值得买」决定。

两种工作模式：

1. **Brief / Prompt 模式**：只交付视觉简报与可执行图片 prompt。用户没有明确要求出图时默认走这里。
2. **Generate 模式**：用户明确要求“生图/出图/生成图片/render”时，先完成 prompt，再沿 TapCanvas 自有生图链路真实产出图片资产。

## 边界与交接

- 本 Skill 负责商品、店铺与营销**静图**的策略、prompt 与图片包编排。
- 视频成片、广告片与带货视频交给 `tvc-ad-director` / `tapcanvas-video-workflow`；本 Skill 只提供其中的静帧与 packshot 图方向。
- 小红书/公众号**封面**（内容型封面，主体是标题与信息密度）交给 `xhs-cover-anchor`；本 Skill 处理的是商品与店铺视觉。
- 需要设计角色、场景或道具的可复用身份锚时，交给 `tapcanvas-character-card` / `tapcanvas-scene-card` / `tapcanvas-prop-card`，本 Skill 不新建身份卡体系。
- 只问模型参数、渠道限制或接口能力时，读当前动态 schema，不用本 Skill 代答。

不要索取、写入或回显任何 API key。本项目的生图能力由自有链路提供，不需要用户配置外部密钥。

## 单一操作回环

1. 判断图片**用途**（主图 / 副图 / 详情页屏 / 广告位 / 社媒 / 店铺）与**转化驱动力**（视觉驱动 / 痛点驱动 / 情感价值驱动，判据见 `references/conversion-sequences.md`）。
2. 按语义从下方**场景方向索引**选择本轮真正需要的方向，只读取对应的模板文件。
3. 只收集会实质改变画面结果的缺失信息；非关键字段明确假设后继续，不无谓阻塞。
4. 形成视觉简报：主体、用途、受众语境、风格、构图与比例、图片内文字、否定约束。
5. 任务包含多张图时，先建立 **Campaign Style Lock**，锁定整套图的色板、冷暖调、字体、背景、光线、布局与图标风格。
6. 写出可执行 prompt，逐条对照下方铁律；多图任务把同一段 Style Lock **原样**放进每张 prompt 的第一段。
7. 商品或营销任务先完成转化驱动力诊断，再决定画面顺序，不要从模板堆里挑图型凑数。
8. 用户要求整套商品图时，交付 **5 张主图 + 7-9 张详情页**的图片包计划。
9. 用户明确要求出图时按下方执行链路真实提交；否则交付 prompt 包。

## 出图执行（TapCanvas 唯一链路）

**禁止**：调用第三方图像 API、注册外部图床、设置任何 `*_API_KEY`、安装上游脚本、把 base64/临时路径/第三方临时链接当作交付资产。

### agents bridge / 小T 会话

1. `tapcanvas_get_tool_schema({name:"tapcanvas_image_generate_to_canvas"})` 读取当前请求作用域下的动态 schema。
2. `tapcanvas_call_tool({name:"tapcanvas_image_generate_to_canvas", args:{...}})` 逐张提交。

### 终端 / CLI

统一走 `apps/agents-cli/skills/tapcanvas-api`（`toolExecute` → 同一业务工具，或 `draw` endpoint）。不得绕过该 skill 直接拼接请求。

### 产品一致性

- 用户提供产品照片时，参考图比文字描述更有效，必须把参考图传入：普通生图用 `referenceImageNodeIds` / `referenceAssetIds`，需要区分职责时用 `referenceAssetBindings:[{assetId,role,strength?}]`，`role` 取 `content`（产品外观）或 `identity`。
- 只传节点/资产 ID；**禁止**向 agent 面工具传 URL，也禁止传 `referenceImages`、`styleImages`、`styleReferenceImages`、`imageUrl`、`assetInputs[].url`。
- 项目已有全局画风锚时，由服务端在付费边界注入，不要自行复制、丢弃或另造第二套画风。

### 规格与批量

- 比例：主图默认 `1:1`，详情页默认 `2:3`，按平台要求调整。
- 分辨率：本项目**封顶 2K**。不要在 prompt 或交付说明里声称 4K/8K。
- 一张图一份 prompt，一次调用只出一屏；禁止用一条 prompt 生成多屏拼图。
- 批量出图只在用户明确要求整套时提交，按图片包编号逐张提交，保持同一 Style Lock。
- 工具缺失、模型不可用、上传未取得真实资产 URL 时**原地显式报告**该项失败，保留已成功资产，不伪造结果、不静默换模型、不用占位图兜底。

## GPT-Image-2 铁律

每条 prompt 逐条检查。这些不是建议，是实测翻车点。

### 1. 颜色写 hex，不写形容词

“白底”出来是淡灰，“金色”出来有 8 种金。

| 意图 | 写法 |
|---|---|
| 白底 | `#FFFFFF` |
| 深灰文字 | `#2D2D2D` |
| 浅灰标注 | `#888888` |
| 金色强调 | `#D4AF37` |
| 浅米色背景 | `#F5F1E8` |
| 深绿背景 | `#1A3A2E` |

### 2. 产品占比必须数字化

| 图型 | 产品占比 | 说明 |
|---|---|---|
| 白底主图 | 35-40% | 太小显廉价，太大显拥挤 |
| 卖点副图 | 25-30% | 左图右文布局，产品在左 |
| 场景氛围图 | 20-25% | 氛围才是主角 |
| 信息流广告 | 40% | 环境干扰多，产品要更突出 |
| 搜索广告 | 45% | 比信息流再大一点 |
| SKU 多规格卡 | 60-70%（整体） | 多个产品横排 |

### 3. 留白必须显式声明

不写留白，模型一定把画面填满。

- 白底主图 / 卖点副图 / 广告图：`留白至少 45%`
- 场景氛围图：`留白至少 50%`
- 详情页长图：`留白 50%+`

### 4. 否定清单不能省

每条 prompt 结尾写**具体**禁止项，不要写笼统的“不要多余的”：

```text
不要添加：道具、手、水印、假 logo、额外文字、装饰元素、渐变背景
```

### 5. 平台预留空间

国内电商主图必须显式留出平台叠加区，写“留空间”模型会当没看见：

- `顶部中央 200×100 区域留空（平台价格叠加区）`
- `左上角 200×100 像素区域完全留白`（需要 logo 位时）

### 6. 图片内文字用 3 层信息架构

- 核心承诺 ≤15 字（主标题）
- 关键证据 2-3 个（图标 + 短标签）
- 行动指令 ≤8 字（CTA 按钮）

### 7. 批量出图优于反复调参

一次按 2K 出图，让数据选风格，不要凭审美逐张微调。

## Campaign Style Lock

多图任务的视觉合同，不是灵感描述。用户没有品牌规范时使用默认模板，并**逐字复用**。

### 必填字段

1. **视觉方向**：例如 premium tech ecommerce、clean household care、warm gift editorial。
2. **固定色板**：2-3 个主色 + 1 个强调色；背景色、文字色、强调色全部写 hex。
3. **冷暖调**：warm / cool / neutral，全套一致。
4. **字体系统**：一种字体风格，例如 modern geometric sans-serif；禁止混用衬线、手写、复古、卡通。
5. **背景系统**：统一材质、空间与深浅。
6. **光线系统**：统一光源方向、阴影强度、反光质感。
7. **布局系统**：统一留白、圆角、分栏、标签、编号与信息图组件风格。
8. **图标 / 插画系统**：统一线宽、形状、颜色复杂度。
9. **产品呈现规则**：角度、比例、材质表现与是否居中必须稳定。
10. **禁止漂移项**：明确禁止 changing color palette、mixed fonts、inconsistent lighting、random backgrounds、mismatched icon styles。

### 默认 Style Lock

```text
Campaign Style Lock: consistent premium ecommerce visual system across the entire image set; fixed palette of clean off-white background, deep charcoal text, one product-matched accent color, and one soft secondary accent; neutral-cool studio lighting; modern geometric sans-serif headline placeholders only; consistent rounded rectangular info labels; consistent thin-line icon style; clean high-end product photography mixed with minimal infographic elements; stable product scale and placement; generous whitespace; no color palette changes, no mixed fonts, no random backgrounds, no inconsistent lighting, no mismatched icon styles.
```

### 多图强制规则

- 每张图 prompt 的第一段是**同一段** Style Lock，不改写、不缩短、不换同义词。
- 单张图只能改变：画面目的、主体动作、局部构图、短文案。
- 单张图不能改变：色板、冷暖调、字体、背景系统、光线系统、图标风格、信息标签样式。
- 重生其中一张时必须复用原 Style Lock。
- 已出图风格不一致时重写整个 prompt 包，不要逐张随意补描述。

## 场景方向索引

`references/templates/` 下有 25 个场景模板，每个含 `scenario`、`prompt_template`、`variants`、`category_tips`、`examples`、`anti_ai_tips`。

这是给你做**语义判断**的导航索引：选择依据是用户真实用途与产品事实，不是用户碰巧说了哪个词。不要在本地代码里维护关键词匹配来选模板。

| 场景方向 | 模板 |
|---|---|
| 白底/纯色底产品主图 | `01-hero-image.json` |
| 场景化生活图 | `02-lifestyle-scene.json` |
| 平铺俯拍图 | `03-flat-lay.json` |
| 细节微距图 | `04-detail-macro.json` |
| 促销海报 / Banner | `05-poster-banner.json` |
| 社交媒体素材 | `06-social-media.json` |
| UGC / 买家秀 | `07-ugc-style.json` |
| 模特展示图 | `08-model-showcase.json` |
| 使用前后对比 | `09-before-after.json` |
| 包装 / 礼盒 / 开箱 | `10-packaging.json` |
| 信息图 / A+ / 详情页信息屏 | `11-infographic.json` |
| 创意概念广告图 | `12-creative-concept.json` |
| 尺寸规格 + 使用步骤 | `13-size-spec.json` |
| 多产品套装 / 组合 | `14-multi-product.json` |
| 电商直播间场景 | `15-livestream.json` |
| 虚拟试穿 / 产品融入 | `16-try-on-virtual.json` |
| 技术拆解 / 爆炸图 | `17-exploded-view.json` |
| 隐形模特（服装） | `18-ghost-mannequin.json` |
| 产品多角度网格 | `19-multi-angle-grid.json` |
| 杂志大片 / 封面 | `20-magazine-editorial.json` |
| 季节主题 campaign | `21-seasonal-campaign.json` |
| 奢华氛围渲染 | `22-luxury-atmospherics.json` |
| 设备界面 mockup | `23-device-mockup.json` |
| 店铺门面 / 空间 | `24-storefront.json` |
| 运动 / 健身广告 | `25-sports-campaign.json` |

**按需读取**：只打开本轮真正用到的模板文件，不要一次性加载全部。无匹配方向时以 `01-hero-image.json` 为起点。

使用方式：取 `prompt_template` 作为结构，用产品信息替换 `{variables}`；用户指定风格时应用 `variants.<name>.overrides`；已知品类时应用 `category_tips.<category>`；只保留有值的字段，输出简洁的自然语言 prompt。

## 深化阅读

按当前任务的实际缺口选择，不要全量预读：

- `references/conversion-sequences.md`：转化驱动力三型、主图与详情页序列、详情页信息图结构、多角度与景别分配、视觉节奏、字体搭配。
- `references/prompt-craft.md`：prompt 组织与精简原则、中文字渲染规则、UGC/直播/社媒的 Anti-AI 真实感技巧、翻车点防护。
- `references/templates/`：上方索引对应的场景模板。

## QA 检查

交付前逐条确认：

- prompt 符合用户真实目标，且基于匹配到的模板 `prompt_template` 组装。
- 颜色是 hex、产品占比与留白是数字、结尾有具体否定清单、国内平台预留位已声明。
- prompt 保持简洁，没有冗余约束与重复描述。
- 商品/营销任务已完成转化驱动力诊断。
- 多图任务每张复用同一 Style Lock；角度与景别已分配，无连续 3 张相同角度，全景占比 ≤ 40%。
- 详情页每屏是电商信息图结构（标题、图标、标签、利益点、步骤或信任徽章），不是换角度的产品照。
- 图片内文字短且必要；中文用「」引号包裹；提醒用户出图后放大 200% 逐字核对笔画。
- UGC/直播/社媒场景已应用对应模板的 `anti_ai_tips`。
- 用户提供了参考图时已按 ID 传入，没有改用文字描述替代。
- 证据缺失处写成占位，没有编造认证、实验数据、评分、销量或真实评价。
- 输出与文件中没有 API key 或私密凭据。

## 输出格式

Brief / Prompt 模式：

1. **匹配方向**：使用的模板文件与场景类型
2. **Visual Brief**
3. **Final Image Prompt**
4. **Negative Constraints**
5. **Assumptions**

商品或营销任务追加：

1. **Conversion Driver Diagnosis**
2. **Campaign Style Lock**（多图任务必给）
3. **Hero Image Sequence**（标注每张对应模板）
4. **PDP Detail Image Sequence**（涉及详情页 / PDP / 整套商品图时）
5. **Copy Lines**（图片需要文字时）
6. **Test Priorities**

Generate 模式追加：

1. **Image Pack Plan**：每张图的编号、用途、尺寸、对应模板、短文案
2. **Generated Files**：真实资产与节点身份
3. **Assumptions / Notes**

## 常见翻车点

| 翻车 | 原因 | 防护 |
|---|---|---|
| 中文字笔画错 | 模型中文准确率约 95%，复杂字易少笔画 | 放大 200% 逐字核对；复杂字换简单同义字 |
| 品牌色漂移 | 写“金色”出来 8 种金 | 全部用 hex |
| Logo 区被填满 | “留空间”被忽略 | 写精确坐标 |
| 背景不是纯白 | 写“白底”出来淡灰 | 写 `#FFFFFF` |
| 产品过大或过小 | 没指定占比 | 写具体百分比 |
| 画面填满无留白 | 没写留白要求 | 显式声明比例 |
| 连续多张视觉疲劳 | 背景色全一样 | 交替使用 2-3 种背景色 |
| 全套图角度雷同 | 模型默认正面 3/4 角 | 每张显式写角度；主图 ≥3 种，详情页 ≥4 种 |
| 详情页变成纯产品图 | 只换角度，没有信息图结构 | 每张详情页以 `E-commerce infographic` 开头 |
| 服装/3C 翻车率高 | 面料垂坠、人体比例、接口细节要求过高 | 优先稳定品类；服装必须用参考图 |
