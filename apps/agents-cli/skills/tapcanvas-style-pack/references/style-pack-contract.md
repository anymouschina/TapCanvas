# TapCanvas Style Pack v1 Contract

## 读取时机

创建、更新、审查或应用完整风格包时读取本文件。它定义数据内容，不要求后端新增自定义节点类型；当前使用普通 `text` 节点承载可读 Markdown。

## 节点落点

通过 `tapcanvas_flow_patch` 新建节点：

```json
{
  "type": "taskNode",
  "position": { "x": 0, "y": 0 },
  "data": {
    "kind": "text",
    "label": "风格包｜<名称>｜v<版本>",
    "productionLayer": "anchors",
    "content": "<完整 Markdown 风格包>"
  }
}
```

位置必须依据当前画布已有节点计算，不能把示例中的 `0,0` 当固定位置。具体可写字段以运行时 `tapcanvas_flow_patch` schema 为准。

## 用户第一方文字影调

用户通过画布「项目视觉圣经」入口上传或粘贴的影调、色调、灯光、时代或其他视觉文字不是参考图提取结果。该输入按 `project-look-bible/v1` 编译，并创建：

```json
{
  "type": "taskNode",
  "position": { "x": "依据当前画布计算", "y": "依据当前画布计算" },
  "data": {
    "kind": "text",
    "label": "项目影调｜<名称>｜候选",
    "productionLayer": "anchors",
    "semanticKind": "projectLookBible",
    "projectLookBibleStatus": "candidate",
    "content": "<完整可读 Markdown 影调文档>"
  }
}
```

然后用 `tapcanvas_project_look_bible_confirm({sourceNodeId,lookBible})` 激活不可变版本。结构化 `lookBible` 必须包含：

- `schemaVersion=project-look-bible/v1`；
- `name/summary`；
- `globalCore.styleName/summary/visualDirectives/negativeDirectives/consistencyRules/characterPrompt/imagePrompt/videoPrompt`；
- `sections[].id/name/dimension/applicability/directives/imagePrompt/videoPrompt`；`dimension` 是开放语义，不使用本地枚举或关键词路由；
- `contentExclusions[]`。

追加或更新前必须先用 `tapcanvas_project_look_bible_get` 读取当前激活版本；保留用户本轮未覆盖的 `sections`，将新增或明确覆盖的维度合并为完整新版本。确认工具会 fresh-read 当前授权画布的来源节点、保存项目资产版本，并把节点标记为 `approved`。旧版本和已生成资产保持不变。Project Look Bible 的适用文字投影进入图片和视频；项目画风参考图只进入风格理解与来源证据，不再作为独立 `style` 图片提交生成模型。身份、场景、布局与首尾帧等内容参考继续按真实职责及冻结的 `generationContract.referenceImagePolicy` 使用。

## 完整内容结构

风格包 Markdown 按以下顺序组织。

### 1. Identity

- `schema`: `tapcanvas-style-pack/v1`
- 风格包名称、版本、创建时间
- 状态：`candidate` / `approved` / `superseded`
- 适用媒介和画幅
- 一句话风格定位
- 来源风格包节点 id（更新时）

### 2. Source References

原创方向可没有参考图，此时明确记录 `agent_authored` 与真实任务/故事依据，不制造参考 URL、分析回执或用户确认状态。已有参考的提取模式中，每张参考图记录：

- 稳定引用 id；
- 真实 URL；
- 来源类型：用户上传 / 画布节点 / 项目资产；
- 来源 nodeId 或资产 id（存在时）；
- 分析状态与失败原因；
- 被哪些全局规则或模块引用。

不要把 URL 截断成不可访问的展示文本。不要抄写临时本地路径或 base64。

### 3. Evidence Matrix

每张图一行，记录可观察事实与不可迁移内容：

| Ref | 媒介/处理 | 色彩 | 光线 | 构图/镜头 | 材质 | 情绪/用途 | 不可迁移内容 |
|---|---|---|---|---|---|---|---|

单图观察不能直接升级为跨图稳定规则。

### 4. Global Style Core

- `styleName`
- 渲染媒介和画面处理
- `visualDirectives`：可执行、互不重复，优先 4-8 条
- `negativeDirectives`：防止风格漂移，不混入内容安全判断
- `consistencyRules`：跨图、跨镜、跨章节要稳定的视觉属性
- 角色生成模板不属于风格包；角色卡由 `tapcanvas-character-card` 结合此处的画风事实独立编译
- 适用范围与不适用范围

参考提取规则追加证据引用，例如 `[refs: R01,R03,R06]`；推断或弱证据追加 `[confidence: low]`。原创规则标记 `[origin: agent_authored]` 并说明当前任务依据，不伪造 refs。

### 5. Visual Modules

每个模块至少包含：

- 模块 id、名称、解决的镜头功能；
- 证据引用与反例；
- 一句可执行的 `visualLock`；
- 可替换变量：主体、动作、空间、道具、环境力；
- 色彩关系、光线结构、构图景别、焦段/景深倾向；
- 材质和画面处理；
- 图片提示词规则；
- 视频运动规则：主体动作、镜头运动、焦点变化、环境微变化；
- 画面限制、常见跑偏和修正方式。

模块由镜头功能和视觉语法定义，不由原片人物或地点命名。

### 6. Color System

- 全局色温、饱和度、明暗和高光/阴影偏色；
- 各模块的主色职责、辅助色职责、点缀色职责；
- 色值来源状态：`semantic_estimate` / `sampled` / `verified` / `unavailable`；
- 若有色值，逐项记录证据和生成工具；
- 若有真实色卡资产，记录标注版、纯色版、总览的真实 URL 与生成任务证据。

`sampled` 表示从像素确定性取样；`verified` 还要求结构和图片验收通过。视觉模型描述或人工目测只能标 `semantic_estimate`。

推荐的精确调色板模型是每模块 10 色：3 个主色、5 个辅助色、2 个点缀色。只有确定性采样证据存在时才填满该模型；不能复制或臆造色值凑数。

### 7. Originality Boundary

- `transferableGrammar`：允许迁移的抽象视觉规则；
- `contentExclusions`：不得复用的具体人物、脸、服装组合、地点、道具、品牌、文字、剧情和经典构图；
- `transformationTest`：移除原图专有内容后，规则是否仍然成立；
- 用户自有原图编辑的例外范围。

### 8. Application Recipe

记录如何选择模块、如何填变量、如何写图片提示词、如何写视频提示词、如何绑定真实风格参考图，以及如何与角色卡、场景卡和道具卡共同工作。

不要把应用流程写成固定意图路由。小 T 应根据本轮真实上下文自主选模块，并说明证据。

### 9. Validation

- 参考覆盖：成功 / 部分 / 失败；
- 规则证据覆盖率；
- 内部冲突与解决方式；
- 原创迁移检查；
- 颜色真实性状态；
- 节点落点、Style Bible 写入结果和真实资产证据；
- 已知缺口与下一步所需工具或用户输入。

## 映射到书级 Style Bible

只有用户明确授权应用时，才把 `Global Style Core` 的 `styleName / visualDirectives / negativeDirectives / consistencyRules` 映射给 `tapcanvas_book_style_confirm`。参考图通过稳定节点 ID / 资产 ID 提交，由服务端解析；角色提示词模板不进入 Style Bible。模块、证据矩阵、颜色来源状态和原创边界不属于当前 Style Bible 的精简字段，应留在风格包节点。

如果 Style Bible 已存在，本次写入是替换式更新相应显式字段。先读后写，并在结果中列出被替换字段；没有用户授权时只建立 `candidate` 风格包节点。

## 应用交付表

用户只要求提示词时，可在风格包节点后新增一个文本节点，使用以下列：

| 镜头 | 新内容/剧情功能 | 采用模块 | 原创元素 | 借用的视觉语法 | 图片提示词 | 视频提示词 | 衔接/连续性 | 证据 |
|---|---|---|---|---|---|---|---|---|

“原创元素”必须来自用户的新内容；“借用的视觉语法”只写抽象规则；“证据”指向风格包模块和参考 id。用户要求直接生成时，提示词表只是执行输入，不是最终交付，必须继续调用真实图片或视频工具。
