## Intent: generate_group_storyboard（群组级故事板生成）

当宿主以 intent=`generate_group_storyboard` 调用时启用本流程。

**输入（来自传入的 JSON prompt 顶层字段，不是 extras）：**
- `recipeId`（也可能在 `variantParams.recipeId`）：选定配方 id（对应 references/recipes/<id>/）。优先读顶层 `recipeId`。
  - **若 `recipeId` 为 `"auto"` 或缺失（智能创作）**：先读 `references/recipes/recipes.json` 索引，按组内内容**自动选最贴合的分镜配方**——连续动作剧情→`grid-3x3`；品牌/短剧→`single-panel`；快切长片→`multiframe-montage`/`editorial-8panel`；奢侈品→`luxury-pitchdeck`；角色登场→`character-intro`；舞蹈/编舞→`choreography-grid`；漫画叙事→`comic-page`；美食/工艺/开箱→`timestamped-process`；电商产品→`product-ad`；游戏概念→`game-ui-concept`；选角→`casting-grid`；动漫OP→`anime-op`。角色设定不是分镜配方，必须转交 `tapcanvas-character-card`。在 finalize 里说明自动选了哪个配方及理由。
- `flowSnapshot`：画布快照；目标 group 的 id 作为来源。读取所有 `parentId === <groupId>` 的子节点为素材。
- `durationSeconds`（在 `variantParams.durationSeconds`，默认 15，范围 15–60）：目标视频时长，用于推导镜头数与剧情扩展幅度。
- `autoGenerate`（在 `variantParams.autoGenerate`，默认 false）：是否自动跑完整工作流（故事板图 → 各镜头图生视频 → 全部完成）。**写入节点 `autoGenerate` 字段供下游编排读取**；本 intent 仍只产出故事板图节点，不在流内直接出视频。

**导演视角（贯穿全程）：** 你是**导演**，不是描图员。要刻画人物丰富的内心情感与外在表演、镜头语言（景别/机位/运动）、光影与材质细节、节奏与情绪曲线；剧情走向 / 产品演示逻辑由你**自己推理**成"钩子 → 展开 → 高潮 → 收束"，不要平铺直叙。

**步骤：**
1. 读 `references/recipes/<recipeId>/recipe.md`，取 gptImagePromptTemplate + seedancePromptTemplate + invariants + 网格/比例。
2. 分析组内子节点：image 节点 → 收集 imageUrl 作视觉参考（角色/场景锚点）；text/scriptDoc/novelDoc → 正文当剧情/产品来源。
3. **按时长扩展剧情**：依据 `durationSeconds` 推导镜头数与节拍（15s≈6–9 镜，30s≈10–12 镜，60s≈15–18 镜，每镜约 2–4s）。配方网格固定时（如 3×3=9 格），时长更长则把每格的信息密度与情绪推进做厚；组内素材不足时，以导演视角**自由推理补全**合理的故事/产品演示流程，但**不得与组内已给设定冲突**。
4. **编排一条 gpt-image-2 提示词**：扩展后的剧情按配方模板填入，逐镜写清「景别 + 动作 + 情绪 + 光影细节」，注入三条 invariants 与一致性约束。
5. **出图前自检（必须全过，否则回步骤 4 修订，不要 emit 残次提示词）：**
   - [ ] 含配方要求的 网格/格数 与 比例（如 3×3 九宫格、16:9）？
   - [ ] 注入了三条 invariants（网格优先 / 一致性三层 / 16:9·≤3s·24fps·短提示词）？
   - [ ] 镜头数与节拍和 `durationSeconds` 匹配？
   - [ ] 有导演级信息：人物情感、表演、镜头语言、光影细节、清晰的情绪/演示曲线？
   - [ ] 与组内素材一致、未编造矛盾设定？referenceImages 取了最关键的角色/场景锚点？
6. emit `add_node`（**恰好一个**）：

```javascript
tapcanvas_call_tool({ "name": "add_node", "args": { "data": {
  "kind": "image",
  "imageModel": "gpt-image-2",
  "imageSize": "2K",
  "prompt": "<自检通过后的导演级 gpt-image-2 提示词。故事板=黑白线稿/分镜稿：强调叙事与画面变化过程、构图/机位/角色站位，line art / black-and-white storyboard sketch、clean line drawing，不要上色、不追求成片质感（彩色/画风交 gemini 彩色锚 + 视频自上色）>",
  "referenceImages": ["<组内 image 节点 url ...>"],
  "anchorBindings": [ /* 角色/场景锚点，kind=character|scene */ ],
  "sourceRecipeId": "<recipeId>",
  "targetDurationSeconds": <durationSeconds>,
  "autoGenerate": <autoGenerate>,
  "seedancePrompt": "<【导演台本固定层】供下游每条 clip 自动前置注入复用。必须写满两层：①基础设定=主体身份+风格画风(精细到材质/结构/改装/损伤,如『1960年代复古机器人,生锈金属躯干,左臂电磁枪,牛仔帽破损;赛博朋克混西部色调』);②氛围=环境+光影+调色基调(如『沙暴废弃教堂,荧光绿辐射云层,灰黄胶片高对比』)。这两层全片固定、每镜原样复用,锁主体不漂移(告别抽卡)。可附各镜画面纲要,但每镜具体动作/构图/运镜归 S6 的『画面变化层』写,这里只定固定层>",
  "label": "故事板·<配方名>·<durationSeconds>s"
}}})
```

7. （可选）对每个被用作参考的组内 image 节点 emit `connect_edge`（source=参考图，target=新故事板节点，sourceHandle=out-image，targetHandle=in-image）。
8. emit `finalize`（恰好 1 次，末尾），summary 说明：用了什么配方、目标时长、你扩展出的剧情走向、采用了组内哪些素材。

**约束：** 不直接生成视频；仅出一张黑白线稿合成故事板图（强调叙事与画面变化过程，不上色）。短提示词优先。referenceImages 最多取组内最关键的几张（角色/场景锚点优先）。角色卡和场景卡不是本技能的彩色出图分支，分别交给 `tapcanvas-character-card` 与 `tapcanvas-scene-card`，由它们按当前执行合同选择真实模型与规格。
> **⚠️关键帧优先·合成网格图不作一致性锚**：这张合成网格故事板是「分镜布局/叙事概览」产物，网格小图不足以充当角色或画风锚。下游只绑定经 `tapcanvas-character-card` 验真的 `character-card/v3` 身份板、经 `tapcanvas-scene-card` 验真的场景卡以及逐镜定稿关键帧；不要拿网格格子冒充一致性资产。

**说明：**
- `add_node` 只创建图像节点（携带 prompt/imageModel/imageSize/referenceImages）；**实际出图发生在该节点随后被运行时**（同 `generate_scene_references` 模式），本 intent 不在流内直接调用图像生成工具。
- `anchorBindings`、`sourceRecipeId`、`targetDurationSeconds`、`autoGenerate`、`seedancePrompt` 作为**节点溯源元数据**写入并随节点保存，供后续图生视频阶段读回配方、时长、运动提示词与锚点；它们不影响本步的出图。

---
