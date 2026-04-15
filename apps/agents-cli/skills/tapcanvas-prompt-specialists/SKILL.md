---
name: tapcanvas-prompt-specialists
description: 定义 image_prompt_specialist、video_prompt_specialist、pacing_reviewer 的职责边界、触发条件与最小输出契约；不强制固定调用顺序。
---

# TapCanvas Prompt Specialists

## 何时使用

- 主代理需要把图片/视频提示词生产委托给 specialist
- 任务已经具备足够证据，适合进入专门提示词产出阶段

## 输入证据

- 只传本轮已证实事实
- 推荐包含：目标、关键视觉事实、必须保留、禁止项、对白、时长/节奏上限
- 不要把未确认剧情、角色设定或猜测状态交给 specialist

## 执行原则

- 是否调用 specialist，由主代理决定
- 不维持固定的后端调用顺序；但当目标是 chapter-grounded 的最终图片/分镜提示词时，应优先使用 `image_prompt_specialist`，当目标是最终视频提示词时，应组合 `video_prompt_specialist` 与 `pacing_reviewer`
- handoff 要小而硬，只传最有价值的已证实事实
- specialist 结果必须能回溯到证据，不得成为新事实来源
- 当目标是“优化当前图片节点提示词”时，主代理可以把当前节点的 `prompt/systemPrompt/negativePrompt`、结果图、参考图和用户本轮明确要求交给 `image_prompt_specialist`，再把 specialist 结果回写原节点
- specialist 负责产出更可执行的视觉提示词，不负责决定是否新建节点；若用户没有要求分叉，主代理应优先更新当前节点而不是复制一份新节点
- 若当前选中输入只是角色卡、三视图或角色参考，而不是已确认场景关键帧，handoff 中必须如实标注为“角色锚点/参考输入”，不得伪装成已确认场景

## 输出契约

- `image_prompt_specialist`
  - 最小结果：`{"imagePrompt": string}`
  - 对普通图片优化任务，可只返回 `imagePrompt`
  - 对 chapter-grounded / storyboard / keyframe 图片生产，若要额外返回结构化 JSON 编辑视图，最小结果升级为 `{"imagePrompt": string, "structuredPrompt": {...}}`
  - `structuredPrompt` 是与 `imagePrompt` 等价的结构化提示词视图；`imagePrompt` / 节点 `prompt` 仍是最终执行字段。两者必须可由同一份内容对齐，不要只给其中一个然后假设下游会脑补另一半
  - `structuredPrompt` 至少必须包含：
    - `version: "v2"`
    - `shotIntent`
    - `spatialLayout`
    - `cameraPlan`
    - `lightingPlan`
    - `continuityConstraints`
    - `negativeConstraints`
  - `imagePrompt` 必须是可直接给图片模型执行的最终长提示词，不得退化成一句摘要、标题或营销式短句
  - 对 chapter-grounded / storyboard / keyframe 场景，`imagePrompt` 默认应是高信息密度长提示词：优先覆盖并按自然顺序折叠进正文
    - 时间/天气/光线
    - 场景拓扑与空间层次
    - 前景 / 中景 / 背景分别有什么
    - 画面里有几类主体、谁在左/右/前/后、谁与谁发生什么关系
    - 关键道具、机械、建筑、地面、烟尘、纸屑等物理细节
    - 机位、焦段感、景别、构图重心、镜头高度、透视关系
    - 表情与动作边界
    - 风格落点与明确禁止项
  - 若证据复杂，优先写得更具体，而不是更短；不要因为“简洁”主动丢失人物数量、位置关系、动作结果、遮挡关系、景深层次或画面主次
  - 当参考图只是角色卡/三视图/角色锚点时，必须明确写成“人物外观严格参考图X”，但不能把角色锚点误写成完整场景依据
  - 若存在多张参考图，必须在 `imagePrompt` 正文里显式写明图位职责，例如“人物外观严格参考图1，场景构图与冷灰天光延续图2”
  - `structuredPrompt` 推荐增强字段：`subjectRelations`、`environmentObjects`、`styleConstraints`
  - 推荐长度：通常 300-1200 汉字；场景复杂时可以更长，只要信息仍然可执行、无空话、无重复
- `video_prompt_specialist`
  - 最小结果：`{"prompt": string}`
  - 若仍需保留拍点拆解，可额外给 `storyBeatPlan`，但它不是执行字段
  - 当目标是“最终可执行的视频提示词”或 `composeVideo/video` 节点配置时，所有会影响生成的内容都必须直接折叠进 `prompt`：
    - 导演意图
    - 经典镜头语法借鉴
    - 显式动作与结果
    - 物理/空间约束
    - 禁止漂移项
- `pacing_reviewer`
  - 最小结果：`{"compressionRisk": string, "splitRecommendation": string}`
  - 推荐增强字段：`explicitnessReview`、`physicsSanityReview`

若结果缺少最小字段，主代理必须显式失败，不得自行补写成另一套平行版本。视频节点的唯一执行字段是 `prompt`，不要再额外产出平行的 `videoPrompt` 字段。

## 视频提示词治理

- 视频模型不是“忠实执行复杂剧本”的导演，更像“受约束的运动补完器”
- 复杂信息优先拆到上游：
  - 角色身份一致性：角色卡 / 角色锚点
  - 空间拓扑与道具位置：关键帧 / 场景参考
  - 机械接触、坍塌、复杂对打：桥接关键帧 / 预生产 blocking
- 若你无法回答下面这些问题，就不该直接给最终 `prompt`：
  - 谁先动？
  - 动作作用到谁？
  - 画面里可见结果是什么？
  - 镜头如何移动？
  - 哪些内容禁止模型脑补？
  - 是否存在可借鉴的经典镜头语法？若有，它已经怎样被写进最终 `prompt`？
  - 现有资产是否足以支撑这条视频，不足时缺什么？
