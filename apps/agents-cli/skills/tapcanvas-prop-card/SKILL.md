---
name: tapcanvas-prop-card
description: TapCanvas 规范化道具卡的唯一生成与改造 Skill。创建、补全、重建、批量生成或派生可复用道具、武器、法器、器物与关键物件的基态身份锚或状态版本时使用；把来源事实编译为 prop-card/v1、prop-board/v1 与 prop-function/v1，并通过真实节点/素材 ID 落到画布。一次性布景装饰、角色身份、场景空间、单镜动作与 VFX 不使用本 Skill。
disable-model-invocation: false
requires-skills:
  - cinematic-feel-director
  - tapcanvas-api
---

# TapCanvas Prop Card

## 唯一职责

本 Skill 是 canonical 道具身份、可交互结构和状态版本的唯一方法论。目标不是生成一张“高级感产品照”，而是建立后续分镜、关键帧和视频可以稳定复用的物体资产：同一物体换机位仍能识别，抓握、开合、装配、受力和状态变化不会凭镜头重置。

角色身上的固定身份配饰若主要用于识别人，留在 `tapcanvas-character-card`；固定建筑、门窗、柜台和不可移动重型陈设若主要定义空间，留在 `tapcanvas-scene-card`。只有会被拿取、交接、操作、损坏、变形、追踪或独立复用的剧情物体进入本 Skill。一次性无剧情功能的环境纹理不建道具卡。

## 成功标准

- **身份稳定**：轮廓、比例、部件关系、主材质与不可变标记跨视图一致。
- **功能可演**：持握点、支撑点、受力路径、开合/装配关系和可动部件来自来源事实或明确设计判断。
- **状态可追溯**：基态与损坏、展开、污染、缺件、充能等状态分层；状态版引用精确 canonical asset，只写差量。
- **职责隔离**：布局、风格、身份与内容参考各自使用明确绑定；参考图不替代当前镜头动作。
- **资产真实**：用户要真实道具卡时，必须有真实 node/task/status 或既有素材版本证据；文本计划和 URL 口述不算交付。

审美复盘只驱动当前 agent 同链修订，不形成 Hono/Web 的关键词、最低字数、评分或生成门禁。供应商已受理或已生成的资产必须保留，问题以诊断和新版本追加。

## 资产职责

| `propAssetRole` | 用途 | 身份规则 |
| --- | --- | --- |
| `identity_anchor` | 锁定 canonical 基态道具 | `materialIdentity.mode="base"`，使用 `prop-card/v1` |
| `state_variant` | 锁定损坏、展开、污染、缺件、充能等可见状态 | `materialIdentity.mode="state"`，引用精确 `canonicalAssetId` |

纯姿态图或人物持物关系图不是道具身份卡；它们消费道具卡和角色卡，不得反向改写道具结构。剧情现场的偶然落点、手势、火花、血迹或光色也不能焊进基态。

## 输入与证据

按以下顺序读取并保留来源层级：

1. 用户本轮明确指定、用户提供的参考资产及其职责；
2. 正文、剧本、BeatSheet、对象合同和已确认 story facts；
3. 当前项目已确认的道具基态/状态版本、角色卡、场景卡与 style lock；
4. 为可视化与物理可执行性所需的 agent 设计判断。

内部把信息分为 `confirmedFacts`、`designInferences` 与 `freeDesign`。尺寸、内部结构、隐藏机关、材质、所有权与能力没有来源时不得伪装成原文事实；用户允许原创时可以做有理由的设计选择，并明确其属于设计判断。

涉及读取、生成、轮询或写入真实画布时，先加载 `tapcanvas-api`，只通过其公开合同执行。模型上下文只传 node ID、asset ID、version ID 和结构化 descriptor，不复制内部图片 URL。

## 工作流

### 1. 读取并验真现有资产

- 确认 canonical `propName`、当前故事作用域和状态。
- 优先复用匹配的 `referenceType="prop" + propName + propProfileVersion="prop-card/v1"` 已确认资产。
- 基态还必须携带 `materialIdentity={mode:"base",canonicalName:propName}`；状态版必须携带同名 `canonicalName`、精确 `canonicalAssetId`、`stateKey` 与 `stateDescription`。
- 裸 label、prompt、坐标、连线、URL 和“看起来像同一件”都不能证明 canonical 身份。

### 2. 建立道具因果核

写外观前先回答：

- 它在剧情中承担什么不可替代的功能，谁会操作、携带或识别它？
- 它的前/后、上/下、左/右如何由可见结构辨认？
- 正常使用时从哪里握持、支撑、开启、装配、承重或施力？
- 哪些部件能动、能拆、能变形；哪些必须永久保持相对位置？
- 材质和磨损如何由制造、使用、维护、气候与事件解释？
- 哪些变化属于当前状态，哪些属于跨镜稳定身份？

不要用“神秘、精致、古朴、科技感、电影级”代替几何、材料和功能。只有故事确实需要内部机构时才设计机构；普通杯子、信件、钥匙不强制 X 光或机械剖面。

### 3. 编译身份与机能合同

- `propAnchors`：跨镜稳定的轮廓、比例、部件关系、主材质、表面标记和功能性接口；只写可见事实。
- `prohibitedPropDrift`：已有事实的反面边界，例如刀鞘不可消失、开口方向不可翻转、按钮数量不可变化；证据不足就少写。
- `propFunctionSpec.physicalEnvelope`：物体的整体尺度与占用空间；来源未给精确数字时写可追溯的相对尺度，不发明毫米数。
- `orientationAnchors`：让不同机位能辨认同一前后左右的非对称锚。
- `interactionAnchors`：抓握、开合、插接、承托、瞄准或穿戴的稳定接口。
- `supportAndForcePaths`：重量如何落到支点，外力如何经部件传递；没有特殊受力时可为空数组。
- `movingParts`：可动/可拆部件及合法运动范围；无可动部件时为空数组。
- `materialBehaviors`：关键材料在弯折、碰撞、湿润、受热或发光时的可见响应；只写剧情需要且有依据的项。
- `continuityLocks`：跨镜不可重置的开合、装配、缺件、方向和持有状态。

### 4. 选择道具板视图

需要生成 identity anchor 时读取 [references/board-view-selection.md](references/board-view-selection.md)，根据物体的几何与剧情功能选择 `viewRoles`。`hero` 只负责整体识别；至少再有一个能消除几何歧义或证明交互方式的视图。固定三格、固定 4:3、强制文字标签、强制浅色棚拍、强制 X 光都不是合同。

`propBoardSpec` 只描述视图职责和结构不变量：

```json
{
  "version": "prop-board/v1",
  "viewRoles": ["hero", "side", "interaction_detail"],
  "crossViewConsistency": true,
  "referenceRoleIsolation": true,
  "neutralReferenceBackground": true,
  "scaleReferenceMode": "relative_scale_reference",
  "readableTextVisible": false,
  "brandingVisible": false,
  "neutralBaseState": true
}
```

视图数量由物体复杂度决定，不靠最低面板数或固定题材模板。已有可靠布局参考时用 `referenceAssetBindings(role="layout")`；身份、内容和风格参考不得共用同一个 assetId 冒充多种职责。

### 5. 编译节点合同

基态身份卡使用：

```json
{
  "kind": "image",
  "referenceType": "prop",
  "propName": "<canonical propName>",
  "propAssetRole": "identity_anchor",
  "propProfileVersion": "prop-card/v1",
  "materialIdentity": {
    "mode": "base",
    "canonicalName": "<canonical propName>"
  },
  "propBoardSpec": {
    "version": "prop-board/v1",
    "viewRoles": ["<按功能选择的视图职责>"],
    "crossViewConsistency": true,
    "referenceRoleIsolation": true,
    "neutralReferenceBackground": true,
    "scaleReferenceMode": "source_dimensions | relative_scale_reference | source_unspecified",
    "readableTextVisible": false,
    "brandingVisible": false,
    "neutralBaseState": true
  },
  "propAnchors": ["<可见身份事实>"],
  "prohibitedPropDrift": ["<有证据的不可偏移项>"],
  "propFunctionSpec": {
    "version": "prop-function/v1",
    "physicalEnvelope": "<来源尺寸或相对尺度>",
    "orientationAnchors": [],
    "interactionAnchors": [],
    "supportAndForcePaths": [],
    "movingParts": [],
    "materialBehaviors": [],
    "continuityLocks": []
  },
  "prompt": "<本件道具独有的可执行身份板提示词>",
  "referenceImageNodeIds": [],
  "referenceAssetIds": [],
  "approvalStatus": "needs_confirmation",
  "imageModel": "<enabledImageModels 中本轮选定的精确 modelKey>",
  "imageSize": "<实时支持的精确规格>"
}
```

`prompt` 写清资产用途、选定视图、几何与材料身份、交互接口、相对尺度、参考职责和中性基态；不要复制项目全局画风 URL，不要用品牌、引擎名、8K、镜头品牌或负面词堆砌填补缺失设计。

### 6. 派生状态版本

- 使用 `kind="imageEdit"`、`propAssetRole="state_variant"`，引用精确 canonical 基态或上一状态 ID。
- `materialIdentity.mode="state"`，`canonicalName` 与基态逐字一致，`canonicalAssetId` 指向真实 canonical 素材。
- 写精确 `stateKey/stateVersionId/stateDescription/visualStateFacts`，prompt 只描述新增、消退或改变的可见差量。
- 破损、展开、充能、沾染和缺件都不创建第二个 propName；恢复基态时引用精确基态版本，不靠名字猜。
- 临时手势、移动路径、碰撞过程与角色表演留给分镜/视频 writer，不烤进状态卡。

### 7. 执行与对账

- 用户要求真实卡时调用 `tapcanvas_image_generate_to_canvas`，不要创建空壳节点后宣称完成。
- 无依赖道具可在 `nodes[]` 中批量提交；超过工具上限时分批，不得丢项。
- 供应商受理后保留 `running + taskId`，用 `tapcanvas_image_reconcile` 对账同一任务，禁止重复付费提交。
- 新生成资产保持 `needs_confirmation`；生成成功不等于用户已确认。
- 只被授权编译提示词/节点计划时，明确尚无真实资产，下游不得把它当 ready。

## 禁止动作

- 不创建固定题材模板、关键词表、正则路由、固定三格/X 光/4:3/棚拍前缀或最低字数。
- 不根据“武器、法宝、科技道具”等名字自动发明内部机构、能力、尺寸或材料。
- 不把剧情现场、角色手势、偶然光色、血迹或碰撞结果写入基态。
- 不让 state variant 改名成第二件道具，不丢失 canonicalAssetId。
- 不从 label、prompt 或 URL 猜引用身份；不用历史默认模型替代实时目录。
- 不因创作自检不足阻止已受理/已生成资产；只追加诊断与修订版本。

## 最终自检

1. 删除名称后，几何、部件和材质描述是否仍能唯一指向这件道具？
2. 视图是否真正消除了当前物体的几何或交互歧义，而不是为凑面板重复同一角度？
3. 抓握、支撑、受力、开合、装配与可动部件是否互相物理一致？
4. 尺寸、磨损、内部结构和能力是否都有来源或明确设计判断？
5. 基态是否混入剧情瞬时状态；状态版是否只写差量并绑定精确 canonicalAssetId？
6. `referenceType/propName/propAssetRole/propProfileVersion/materialIdentity` 是否完整且同名？
7. 用户要真实资产时，是否已有真实 node/task/status 或 ready 素材证据？
