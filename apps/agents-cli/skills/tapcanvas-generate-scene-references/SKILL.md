---
name: tapcanvas-generate-scene-references
description: TapCanvas 章节场景与人物参考资产的轻量编排 Skill。仅用于 `generate_scene_references` intent：读取章节和真实画布，识别本章需要稳定视觉身份的场景与人物，差量调用 tapcanvas-scene-card / tapcanvas-character-card 编译完整节点，再通过允许的工具落画布。本 Skill 不维护任何场景 prompt、灯光模板、角色模板、固定模型、URL 复用或语义关键词规则。
disable-model-invocation: false
requires-skills:
  - tapcanvas-api
  - tapcanvas-scene-card
  - tapcanvas-character-card
---

# TapCanvas Generate Scene References

## 单一职责

本 Skill 只做五件事：

1. 读取当前章节、项目和画布事实；
2. 识别本章需要稳定视觉资产的 canonical 场景与角色；
3. 用结构化身份和真实 ID 做差量对账；
4. 把场景逐项交给 `tapcanvas-scene-card`，把人物逐项交给 `tapcanvas-character-card`；
5. 逐项提交实际生图，保留真实节点与任务回执，核对完整资产清单。

场景空间设计、材质生态、去同质化、灯光设计与 prompt 只来自 `tapcanvas-scene-card`；角色设计、身份板、状态派生与 prompt 只来自 `tapcanvas-character-card`。本 Skill 不得修改两者编译结果，只补 `sourceNodeId`、`chapterId`、`chapterTitle`、`creationStage` 和画布布局字段。

## 输出工具合同

通过 `tapcanvas-api` 的当前工具目录发现并读取 schema，使用 `tapcanvas_image_generate_to_canvas` 提交实际图片。不得要求已退役的 `add_node` / `finalize`，不能把创建占位节点当作图片交付。

由 Agent 根据章节建立本轮资产清单与真实复用证据，每完成一个独立资产的设计即可提交，不必等其余提示词全部写完。互不依赖的资产可同轮并发；有视觉依赖的资产等待前置真实图片就绪。单张受理只覆盖该项，继续处理剩余清单。已受理项用原 taskId 对账，不重复生成；已有成功资产保留。用户明确只要占位或提示词时才只落节点。

结束前核对清单每项的复用证据、受理回执或未执行原因。提交完成与图片完成分别报告，已受理的媒体不在主对话中反复轮询。

## 1. 读取真实上下文

需要读取用户真实项目、画布、节点或素材时，只通过 `tapcanvas-api`。至少取得：

- `sourceTextNodeId`、`chapterId`、章节标题和全文/视频脚本；
- 当前画布节点的 `id/kind/referenceType/roleName/sceneName/characterAssetRole/sceneAssetRole/stateKey/stateVersionId/status`；
- 可复用素材的 node/material/version ID 与确认状态；
- 当前 project style lock；
- 当前启用图片模型、规格和账号偏好。

禁止从 label、prompt、URL、节点位置、连线或旧 `productionLayer` 猜角色/场景身份。

## 2. 识别本章资产清单

由 agent 直接理解章节语义，列出：

- **场景清单**：每个需要跨镜复用空间身份的 canonical setting；同一地点只有在空间状态或光相需要独立复用时才新增 variant。
- **人物清单**：每个需要跨镜保持身份的角色；没有稳定视觉复用需求的背景人群不强制建单体角色卡。

不得使用关键词表、正则、固定数量、字数档位、主角/配角枚举或 top-N 截断做语义选择。工具单批上限只允许拆批，不得丢弃清单项。

## 3. 结构化差量对账

当前画布已覆盖的唯一判据：

- 人物：`referenceType=character`、精确 `roleName`、正确 `characterAssetRole`，并有 ready/approved 的 canonical node/material/version ID；
- 场景：`referenceType=scene`、精确 `sceneName`、正确 `sceneAssetRole`，并有 ready/approved 的 canonical node/material/version ID。

跨章节复用同样只接受已验真的 ID。历史 URL、label、文本 prompt、占位状态和“看起来同名”不构成覆盖，也不得直接复制成新角色卡或场景卡。

若上游给出的 descriptor 只有 URL：

- 用 `tapcanvas-api` 查到对应 canonical 素材/版本 ID 后才能复用；
- 查不到时视为身份事实不足，交给对应权威 Skill 新建完整资产；
- 禁止为了兼容旧数据保留 URL 物化分支。

身份别名或状态是否等价由 agent 根据真实上下文判断，并显式写回 canonical 名称/状态；本地规则不得自动归并。

## 4. 委派编译

### 场景

把完整场景组、章节事实、已有场景 descriptor、style lock、时间/天气/剧情状态和调度需求一次性交给 `tapcanvas-scene-card`。逐字采用其：

- `sceneAssetRole` 决策；
- `scene-card/v1` 空间锚；
- `scene-lighting/v1` 物理灯光合同；
- `sceneAnchors` / `prohibitedSceneDrift`；
- 基态/variant 精确引用 ID；
- 动态模型与规格；
- 可执行图片 prompt。

不得追加“电影感、高级感、氛围感”后缀，不得按世界观关键词选择兼容/借鉴模板，不得统一加雾、颗粒、霓虹、暖窗或某种固定光型。

首次生图即采用场景 Skill 的纯空间与洁净材质编译结果；人物调度和项目完整风格只作为其输入事实，不在编译后重新拼入人物外观、表演、战斗特效或视频运镜。不得把去人、去噪的二次编辑当作默认补救步骤。

### 人物

把完整角色组、章节事实、关系、已有角色 descriptor、style lock、时期与状态一次性交给 `tapcanvas-character-card`。逐字采用其：

- `characterAssetRole` 决策；
- `character-card/v3` 与 `identity_board_four_view`；
- `identityAnchors` / `prohibitedDrift`；
- 基态/variant 精确引用 ID；
- 动态模型与规格；
- 可执行图片 prompt。

不得追加 Face DNA 随机表、性格到骨相映射、缺陷池、same-face 禁词、固定写实/九头身/焦段或 role-portrait fallback。

## 5. 节点落地

节点 ID：

```text
场景：agent-generate_scene_references-<batchUlid>-scene-<twoDigitIndex>
人物：agent-generate_scene_references-<batchUlid>-char-<twoDigitIndex>
```

`batchUlid` 同批共享；索引从当前同类最大编号继续，避免冲突。默认布局只决定可读位置，不表达语义：场景放源节点左上，人物放源节点左侧；前端可后续重排。

场景 data 至少包含：

```json
{
  "kind": "image",
  "label": "<sceneName> 场景参考图",
  "draftByAgent": true,
  "creationStage": "intent_generate_scene_references",
  "referenceType": "scene",
  "sceneName": "<canonical sceneName>",
  "sceneAssetRole": "<space_anchor | lighting_variant | state_variant>",
  "sceneProfileVersion": "scene-card/v1",
  "sceneAnchors": ["<tapcanvas-scene-card result>"],
  "prohibitedSceneDrift": ["<tapcanvas-scene-card result>"],
  "sceneLightingSpec": "<tapcanvas-scene-card scene-lighting/v1 object>",
  "prompt": "<tapcanvas-scene-card result>",
  "referenceImageNodeIds": ["<verified IDs when needed>"],
  "referenceAssetIds": ["<verified IDs when needed>"],
  "sourceNodeId": "<sourceTextNodeId>",
  "chapterId": "<chapterId>",
  "chapterTitle": "<chapterTitle if known>",
  "approvalStatus": "needs_confirmation",
  "imageModel": "<exact enabled modelKey>",
  "imageSize": "<exact supported option>"
}
```

人物 data 至少包含：

```json
{
  "kind": "image",
  "label": "<roleName> 人物参考图",
  "draftByAgent": true,
  "creationStage": "intent_generate_scene_references",
  "referenceType": "character",
  "roleName": "<canonical roleName>",
  "characterName": "<same canonical roleName for display>",
  "characterAssetRole": "<identity_anchor | state_variant>",
  "characterProfileVersion": "character-card/v3",
  "identityBoardSpec": "<identity_anchor only; exact v3 object>",
  "identityAnchors": ["<tapcanvas-character-card result>"],
  "prohibitedDrift": ["<tapcanvas-character-card result>"],
  "prompt": "<tapcanvas-character-card result>",
  "referenceImageNodeIds": ["<verified IDs when needed>"],
  "referenceAssetIds": ["<verified IDs when needed>"],
  "sourceNodeId": "<sourceTextNodeId>",
  "chapterId": "<chapterId>",
  "chapterTitle": "<chapterTitle if known>",
  "approvalStatus": "needs_confirmation",
  "imageModel": "<exact enabled modelKey>",
  "imageSize": "<exact supported option>"
}
```

项目画风由服务端 style lock 自动注入。角色与场景身份只传 ID，禁止将 URL 写入 prompt、`referenceImages`、`anchorBindings` 或 `assetInputs`。`label` 只用于展示，不承担身份匹配。

## 6. 交付对账

最终交付说明必须基于真实操作列出：

- 本章应有的 canonical 场景清单；
- 本章应有的 canonical 人物清单；
- 每项对应的现有或新增 node ID；
- `sceneAssetRole` / `characterAssetRole` 与状态；
- 本轮实际新增数、复用数和仍待真实生成数。

不得把 reusable descriptor、prompt、节点创建成功或子任务完成直接说成真实图片已生成。清单项缺少对应完整节点时继续同链补齐；只有当前权限确实不能取得必要事实/授权时才显式报告缺口。

## 删除的旧路径

- 删除 scene URL 直接落回画布的复用分支；
- 删除 role URL / role-portrait / label fallback；
- 删除 style reference 缺失即终止的前置闸门；
- 删除世界观关键词表和兼容/借鉴 prompt 分流；
- 删除固定 gpt-image-2、2K、16:9 默认；
- 删除本 Skill 内全部角色、场景与灯光 prompt 模板；
- 删除按固定数量截断角色或场景清单的逻辑。
