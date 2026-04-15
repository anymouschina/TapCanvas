---
name: tapcanvas-storyboard-expert
description: 统一的 TapCanvas 章节分镜专家。用于“漫剧创作/章节剧本/分镜提示词/Seedance 片段脚本/章节出镜头”任务，默认输出 storyboard-director/v1.1 JSON，同时内置 Seedance 时间轴片段脚本、资产规划、对白/OS/VO/闪回格式与连续性收口方法。
disable-model-invocation: false
---

# TapCanvas Storyboard Expert

## 何时使用

当用户要你根据小说/剧本章节生成可执行提示词，并明确要求：

- 分多个镜头输出
- 每个镜头要素齐全
- 可直接用于图像/视频模型生成

## 核心目标

把“叙事文本”转换成“可执行的镜头生产 JSON”，并让输出可同时服务：

- 3D 建模师（形体/材质/姿态约束）
- 导演（调度/镜头/光线/节奏）
- 定格动画（帧步进/微抖动/手工痕迹）
- Seedance / 短剧视频生成（15 秒片段时间轴、镜头节奏、参考图图位、承接上一片段尾帧）

## 统一职责边界

本 skill 是当前仓库里唯一的章节分镜与 Seedance 派生产物主技能，统一负责：

- 章节正文 -> 章节剧本 / 分镜结构
- 角色 / 场景 / 道具资产规划
- Seedance 15 秒片段时间轴脚本
- 对白、OS、VO、闪回、字幕的脚本表达
- 上一片段尾帧 -> 下一片段首帧的连续性收口

若任务需要 Seedance 风格片段脚本，也必须在本 skill 内完成，不允许再切出平行分镜方法论。

## 附属参考资料

本 skill 附带以下权威参考资料：

- `references/seedance-manual.md`
- `references/故事转视频脚本-转换工具.md`
- `references/优化分镜.md`
- `references/好剧本.md`

当用户任务明确落在以下场景时，应主动读取对应 reference，而不是只依赖本文件摘要：

- 多模态 Seedance 输入限制、参考图/参考视频/参考音频用法、视频延长、视频编辑、音乐卡点
- 产品展示、角色动作、旅拍、空间漫游、口播、战争、长镜头追踪、伪纪录片等专门模板
- 从原始故事抽取核心梗、人物小传、三幕/四幕结构、15 秒集数弧线、尾帧衔接检查
- Seedance 提示词优化公式、动作/镜头/光影/画质/约束关键词

## Seedance 多模态能力边界

当宿主明确要求输出可直接用于 Seedance 的提示词时，同时遵守以下多模态边界：

- 最多 12 个输入文件
- 图片参考 `<= 9`
- 视频参考 `<= 3`，总时长 `<= 15s`
- 音频参考 `<= 3`，总时长 `<= 15s`
- 支持的 Seedance 任务模式包括：
  - 参考图像生成
  - 参考视频复刻
  - 视频延长 / 续拍
  - 视频编辑 / 剧情改写
  - 音频驱动口播
  - 音乐卡点剪辑
- 不支持把“写实真人脸部素材”当成稳定可复刻输入；若用户强依赖此能力，必须显式提示限制

这些是 Seedance 侧操作约束，不得在派生 prompt 时遗漏。

## Seedance 任务询问框架

当用户给的信息不足以直接写出稳定的 Seedance 提示词时，先补齐以下信息：

1. 这条视频讲什么故事，核心冲突或卖点是什么
2. 时长是多少，默认是否为 15 秒
3. 现有参考素材有哪些：图片 / 视频 / 音频
4. 画幅比例：`9:16 / 16:9 / 2.35:1`
5. 整体风格、色调和氛围
6. 镜头语言：景别、运镜、转场
7. 动作节奏：舒缓 / 急促 / 是否卡音乐拍点
8. 声音设计：配乐、环境音、对白、旁白

若这些信息无法从上下文证据中恢复，必须显式指出缺口，而不是脑补。

## 输出模式（默认）

默认输出 `JSON`，除非用户明确要求其他格式。

- 仅输出一个 JSON 对象
- 禁止输出 markdown 包裹、解释性前后缀
- 默认必须满足 `assets/storyboard-director-schema.v1.1.json` 的结构约束
- 缺关键输入时显式失败，不输出伪完整 JSON

## 输出模式（扩展）

除默认 JSON 外，当宿主明确要求“视频片段脚本 / Seedance 时间轴 / 剧本正文格式 / 素材清单”时，可在同一套章节理解基础上派生以下补充产物：

- `Seedance timeline prompt`
- `章节剧本正文`
- `资产清单`
- `Ending frame continuity note`

但这些都属于默认 JSON 的派生产物，不得替代默认 JSON 成为唯一交付，除非宿主或用户明确要求只要这些格式。

## 强制输出协议

1. 必须输出多个镜头，不得只给单段大提示词。
2. 顶层必须包含：
   - `schemaVersion`
   - `chapter`
   - `globalStyle`
   - `cast`
   - `relationshipGraph`
   - `modelingSpec`
   - `stopMotionSpec`
   - `atmosphereSpec`
   - `shots`
3. 每个镜头必须包含导演与生产关键字段：
   - `shotId`
   - `durationSec`
   - `narrativeGoal`
   - `subjectAnchors`
   - `crowdRelations`
   - `scene`
   - `rigAndPose`
   - `camera`
   - `lighting`
   - `actionChain`
   - `composition`
   - `dramaticBeat`
   - `performance`
   - `continuity`
   - `continuityLocks`
   - `readabilityChecks`
   - `failureRisks`
   - `negativeConstraints`
   - `prompt`
4. 章节证据不足时必须显式失败并指出缺什么，不得脑补关键剧情。

## 镜头数量规则

- 短章节（<=1200字）：`6-8` 镜头
- 中章节（1201-2500字）：`8-12` 镜头
- 长章节（>2500字）：`12-16` 镜头

若用户指定镜头数，以用户要求为准。

## Seedance 片段节奏规则

当需要把镜头转换成 15 秒视频片段时，优先遵循：

- 对话 / 情感片段：`3-4` 个镜头
- 动作 / 冲突片段：`5-7` 个镜头
- 蒙太奇 / 快节奏序列：`6-8` 个镜头

默认情绪节拍：

- `0-3s` 建立场景与情绪
- `3-9s` 推进动作或冲突
- `9-12s` 打到高潮 / 关键揭示
- `12-15s` 落版 / 余韵 / 悬念

若当前章节镜头要继续驱动 Seedance 片段，必须保证每个镜头都能被压缩或聚合进这一节奏框架，而不是只给静态图片 prompt。

## 视觉可执行约束（CV 友好）

每个镜头都必须满足：

1. 主体明确：至少给出 1 个稳定身份锚点（年龄段/外观/服饰/独特特征）。
2. 群像关系明确：至少写清 `谁与谁`、`关系类型`、`强度`、`冲突/合作状态`。
3. 场景明确：地点 + 时间 + 天气/环境状态至少三要素中的两项。
4. 动作明确：使用可见动作动词，避免“情绪化空话”。
4. 空间明确：前景/中景/远景或左右前后关系至少一种。
5. 相机明确：景别 + 机位 + 运镜 + 焦段，优先补充 `shutterAngleDeg`。
6. 光照明确：主光方向 + 主光角度 + 色温 + 对比关系至少四项。
7. 建模明确：材质、表面磨损、尺度、姿态约束不可缺失。
8. 定格明确：`fpsBase` + `on ones/twos/threes` + `microJitterPx` 至少三项。
9. 连续性明确：和上一镜头至少 1 个共用锚点（角色、道具、方位、时间推进）。
10. 负面约束明确：写出至少 2 条“不要什么”。

## 参考图策略（连续性）

- 首镜头可在无参考图情况下启动，不做强阻断。
- 非首镜头通常应携带至少 1 张参考图（优先上一帧 / 尾帧），用于角色与场景连续性锁定。
- 若非首镜头缺少参考图：允许继续输出，但必须在 `failureRisks` 中显式标注 `referenceMissing` 或等价风险，并在 `continuity`/`continuityLocks` 里写明补救策略。
- 禁止把“无参考图”伪装成“连续性已锁定”。
- 若镜头后续要转成 Seedance / 视频片段 prompt，参考图语义必须可映射到图位职责：
  - 图1：主体 / 角色一致性
  - 图2：场景 / 光线 / 构图延续
  - 若存在上一片段尾帧，优先作为视频续写的首帧连续性依据

## 角色卡前置规划（强制方法论）

- 在生成 chapter-grounded 关键帧、分镜图或镜头提示词前，先检查本章反复出现的主体是否已有可用角色卡锚点。
- 可用角色卡锚点的判定标准是：项目/书籍作用域下已经存在真实角色卡资产，并且能提供可执行图片 URL 与可追溯的 `roleName` / `roleCardId` / 年龄或状态证据。
- 对“本章会重复出现、后续多个镜头要复用”的角色，角色卡锚点必须进一步满足：已经存在真实 `three_view` 资产；只有普通角色图、没有三视图资产，不算满足重复主体锚点条件。
- 若主体尚无角色卡、或当前镜头明确要求特定年龄/状态但现有角色卡无法覆盖，先创建角色卡节点，再继续创建镜头节点；不要跳过这一步直接写“假定已锁定”的镜头 prompt。
- 角色卡节点应优先落成独立 `image` 节点，并带上明确的 `roleName`、`roleId`、`roleCardId`、`sourceBookId`、`materialChapter`、`stateDescription`、`referenceView=three_view` 与参考依据，确保后续镜头可以复用。
- 后续镜头 prompt 可以直接使用 `@角色名` 或 `@角色名-状态` 语法，例如 `@方源-少年 从床上醒来`；当对应角色卡存在时，运行时会把它解析成真实参考图与角色卡绑定，而不是只把它当普通文本。
- 若同名角色存在多张角色卡，必须在镜头约束里给出可区分的年龄/状态/时期证据；若仍无法唯一锁定，应显式失败并指出需要先补哪一张角色卡。
- 这一步属于 agents 的证据规划与产物编排职责，不应假设后端或前端会替你自动决定“先做角色卡还是先出镜头”。

## 场景/道具前置规划（强制方法论）

- 在生成 chapter-grounded 分镜前，若章节元数据已暴露稳定场景或关键道具（例如固定房间、课堂、木盒、法器、载具、机关），必须先检查这些锚点是否已有可执行参考图。
- 对会跨镜头复用的场景/道具，普通文本描述不算完成；必须存在真实视觉参考资产，并能回写到书籍 `visualRefs`。
- 若场景/道具锚点缺失，先创建对应独立 `image` 节点，再继续创建镜头节点；不要在镜头 prompt 里假装“场景已锁定”。
- 这类参考节点应显式携带 `sourceBookId`、`materialChapter`、`visualRefId`、`visualRefName`、`visualRefCategory`；当是 `scene_prop` 锚点时，同时写 `scenePropRefId` / `scenePropRefName`，避免后续节点只能看到不可读的 taskId。

## 节点语义绑定（强制）

- 任何新建的图片/分镜节点，只要绑定了角色或可复用场景/道具，都必须把语义字段直接写进节点数据；禁止依赖 taskId、临时 label 或运行时猜测回填。
- 角色节点最少要带：`roleName`，必要时补 `roleId` / `roleCardId` / `referenceView`。
- 场景/道具节点最少要带：`visualRefName`，必要时补 `visualRefId` / `visualRefCategory` / `scenePropRefName`。
- 若当前证据不足以唯一确定绑定对象，应显式失败并指出缺哪张三视图角色卡或哪张场景/道具参考图，不要写入模糊绑定。

## 剧本正文表达约束（当宿主要求脚本体时）

若宿主需要“剧本正文 / Seedance 分镜脚本”而不只是结构化 JSON，采用下列表达规范：

1. 每个镜头行以 `△ ` 开头。
2. 对白标记使用：
   - `角色名（os）`：内心独白 / 画外音
   - `角色名（vo）`：人物不在画面中的画外音
   - `角色名（怒/惊/喜）`：带情绪对白
3. 特殊结构使用：
   - `【空镜】`
   - `【闪回】` / `【闪回结束】`
   - `【字幕：xxx】`
4. 镜头语言必须具体，不接受空泛“氛围镜头”：
   - 景别：远景 / 全景 / 中景 / 近景 / 特写 / 大特写
   - 运镜：推 / 拉 / 摇 / 移 / 跟 / 环绕 / 升降 / 手持 / 希区柯克变焦 / 一镜到底
5. 连续动作链优先使用 `A -> B -> C` 或 `A → B → C` 表达。

该正文格式是默认 JSON 的可读展开视图，不得与 JSON 语义冲突。

## 资产规划（当宿主要求补齐角色/场景/道具时）

若本轮目标包含“先补齐资产再继续镜头”，可采用以下稳定编号习惯：

- 角色：`C01-C99`
- 场景：`S01-S99`
- 道具：`P01-P99`

每个资产至少明确：

- 名称
- 类别
- 视觉锚点
- 与章节的关系
- 后续要给哪类镜头 / 视频片段复用

资产规划是为了服务执行，不是产出一份脱离 TapCanvas 的独立素材文档。

## Seedance 时间轴派生规则

若宿主明确要求 `Seedance prompt`，从结构化镜头派生时应生成：

- 风格与总体氛围一句话
- `0-3s / 3-6s / 6-9s / 9-12s / 12-15s` 的时间轴描述
- `【声音】`：配乐 / 环境音 / 对白
- `【参考】`：`图1 / 图2` 或 `@资产名` 的职责说明
- `Ending Frame`：记录最后一帧的主体、构图、光线、背景与情绪，用于下一片段连续性

禁止直接把章节摘要粗暴压成 15 秒时间轴。必须先有结构化 shot 级理解，再做时间轴派生。

## Seedance 任务模板矩阵

除章节分镜主链外，本 skill 还必须覆盖原 Seedance 模板矩阵。若任务明显属于以下类型，应优先按对应模板派生，而不是套一个抽象通用模版：

- 叙事故事类
- 产品展示类
- 角色动作类
- 风景旅拍类
- 视频延长 / 续拍
- 视频编辑 / 剧情颠覆
- 情感冲突类
- 产品动效展示类
- 空间漫游类
- 角色对战类
- 口播类
- 音乐卡点类
- 战争场景类
- 长镜头追踪类
- 伪纪录片类

这些模板的完整写法、时间轴组织、`@素材` 引用方式与特殊注意事项，统一见 `references/seedance-manual.md`。

## Seedance 提示词优化公式

当产出单条 Seedance prompt 时，默认使用以下八层公式校验：

`主体 + 动作 + 场景 + 光影 + 镜头语言 + 风格 + 画质 + 约束`

每一层都不能缺失，尤其是：

- 动作要可见、可执行，优先使用“缓慢 / 连贯 / 自然 / 稳定”等抗崩词
- 镜头要具体到景别、机位、运镜
- 光影要明确方向、色温或氛围
- 画质要给保底要求，如 `4K`、细节清晰、无模糊、无闪烁
- 约束要显式写出结构稳定、比例正常、面部不变形、动作不僵硬等防崩条件

避免使用“漂亮、帅气、很酷”这类主观空词；它们不构成可执行约束。

## 故事转剧本结构化步骤

当用户给的是故事、小说、短篇、真实事件，而不是现成分镜时，先按以下顺序拆解，再产出 JSON 或正文：

1. 提炼核心梗（2-4 字）
2. 补齐故事梗概六要素：
   - 故事背景
   - 开场冲突
   - 主角画像
   - 主线事件
   - 结局
3. 写一句话卖点
4. 为主要角色建立人物小传
5. 选择三幕式 / 四幕式骨架
6. 规划每个 15 秒片段的镜头数、情绪弧线与尾帧衔接
7. 再派生出：
   - `storyboard-director/v1.1` JSON
   - `△` 正文剧本
   - `Seedance timeline prompt`

这一整套步骤的细版模板与检查清单见 `references/故事转视频脚本-转换工具.md`。

## 质量检查补充

除本文件的导演 schema 自检外，若宿主要求正文剧本或 Seedance prompt，还必须额外确认：

- 是否有明确的情绪弧线
- 是否包含足够的感官细节（视觉 + 听觉，必要时触觉）
- 是否控制在 15 秒可执行范围内
- 尾帧描述是否足够详细，能直接给下一片段做首帧衔接
- 是否补了音乐 / 音效 / 对话三层声音设计
- 是否使用了清晰的 `@素材` 语法并标明各素材职责

若输出是专门给 Seedance 的单条 prompt，还需再核对一次 `references/优化分镜.md` 中的公式与防崩词是否覆盖完整。

## 禁止项

- 禁止整段堆叠抽象词（如“史诗感、高级感、宿命感”）而无具体可视化细节。
- 禁止同镜头里塞入过多冲突场景/时空跳变。
- 禁止只写文学化描述，不写镜头参数。
- 禁止省略 `负面约束`。
- 禁止跳过 `relationshipGraph` 或 `crowdRelations`。
- 禁止省略光照方向与角度描述。
- 禁止省略 `rigAndPose` 或 `stopMotionSpec`。
- 禁止只写“氛围很好”而不写可观察代理（风、颗粒、湿度、可视化声源）。

## JSON 模板（必须遵守）

```json
{
  "schemaVersion": "storyboard-director/v1.1",
  "chapter": {
    "bookTitle": "string",
    "chapterTitle": "string",
    "sourceSpan": "string"
  },
  "globalStyle": {
    "genre": "string",
    "visualTone": "string",
    "palette": "string",
    "aspectRatio": "16:9",
    "fps": 24
  },
  "modelingSpec": {
    "unitScale": "1m",
    "topologyDetail": "mid-high",
    "materialStyle": "stylized-pbr",
    "textureAging": "blood-stain + dust",
    "clothBehavior": "stiff-heavy"
  },
  "stopMotionSpec": {
    "fpsBase": 24,
    "cadence": "onTwos",
    "microJitterPx": 0.8,
    "holdFrames": [2, 3],
    "imperfectionPolicy": "allow tactile handmade wobble"
  },
  "atmosphereSpec": {
    "tensionLevel": 0.9,
    "airDensity": "dusty-thin",
    "humidityCue": "dry-wind",
    "windVector": "left-to-right",
    "particleType": ["dust", "blood-mist"],
    "soundProxySources": ["cloth-flap", "weapon-hum", "distant-shout"]
  },
  "cast": [
    {
      "id": "char_fangyuan",
      "name": "方源",
      "anchorTraits": ["苍白肤色", "眼神幽深", "黑发", "残破碧绿袍"]
    }
  ],
  "relationshipGraph": [
    {
      "from": "char_fangyuan",
      "to": "group_zhengdao",
      "relationType": "hostile",
      "intensity": 0.95,
      "state": "encirclement"
    }
  ],
  "shots": [
    {
      "shotId": "SHOT_01",
      "durationSec": 3.5,
      "narrativeGoal": "string",
      "subjectAnchors": ["string"],
      "crowdRelations": [
        {
          "group": "group_zhengdao",
          "relationToSubject": "hostile",
          "blocking": "ring",
          "distance": "mid"
        }
      ],
      "scene": {
        "location": "string",
        "timeOfDay": "string",
        "weather": "string",
        "environmentDetails": ["string"]
      },
      "rigAndPose": {
        "centerOfMass": "mid-low",
        "limbConstraints": ["no hyperextension"],
        "forbiddenPoses": ["heroic-victory-pose"],
        "keyPoseNotes": "string"
      },
      "camera": {
        "shotSize": "wide",
        "angle": "high",
        "height": "crane-high",
        "lensMm": 35,
        "shutterAngleDeg": 180,
        "movement": "slow push-in",
        "focusTarget": "char_fangyuan"
      },
      "lighting": {
        "keyDirection": "back-left",
        "keyAngleDeg": 35,
        "colorTempK": 4300,
        "contrastRatio": "high",
        "fillStyle": "minimal",
        "rimLight": "sunset edge"
      },
      "actionChain": ["A -> B -> C"],
      "composition": {
        "foreground": "string",
        "midground": "string",
        "background": "string",
        "spatialRule": "triangular balance"
      },
      "dramaticBeat": {
        "before": "string",
        "during": "string",
        "after": "string"
      },
      "performance": {
        "emotion": "string",
        "microExpression": "string",
        "bodyLanguage": "string"
      },
      "continuity": {
        "fromPrev": "string",
        "persistentAnchors": ["string"],
        "forbiddenDrifts": ["string"]
      },
      "continuityLocks": {
        "identityLock": ["string"],
        "propLock": ["string"],
        "spaceLock": ["string"],
        "lightLock": ["string"]
      },
      "readabilityChecks": {
        "subjectReadable": true,
        "relationshipReadable": true,
        "lightingConsistent": true
      },
      "failureRisks": ["identityDrift", "lightFlip"],
      "negativeConstraints": ["string", "string"],
      "prompt": {
        "cn": "string",
        "enOptional": "string"
      }
    }
  ]
}
```

## 生成前自检

输出前逐条检查：

1. 是否为“多镜头 JSON”而非“单段大提示词”
2. 是否每个镜头字段完整
3. 是否每个镜头都可独立执行
4. 是否存在跨镜头主体漂移风险
5. 是否包含明确负面约束
6. 是否包含群像关系与光照角度
7. 是否包含建模/姿态/定格节奏字段
8. 是否包含氛围代理（风/颗粒/可视化声源）
9. 若镜头 prompt 使用了 `@角色名` / `@角色名-状态`，是否已有对应角色卡或已先补角色卡节点
10. 若当前章需要新的年龄/状态形态，是否先完成角色卡再继续分镜
11. 若宿主要求 Seedance 时间轴，是否已经把结构化镜头压成可执行的 `0-15s` 节奏，而不是只复制镜头标题
12. 若宿主要求剧本正文，是否使用了 `△ / os / vo / 闪回 / 字幕` 的规范表达，且与 JSON 事实一致

任一项不满足，先修正再输出。
