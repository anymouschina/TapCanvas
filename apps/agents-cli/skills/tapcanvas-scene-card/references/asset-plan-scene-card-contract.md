# assetPlans 的场景卡结构合同（一键成片）

本文件只回答一件事：**一键成片 BeatSheet 的 `assetPlans[]` 里，场景项要提交什么结构。**

## 按 role 区分结构

`assetPlans` 的每一项按 role 走不同分支，场景分支与人物分支不能混用：

| role | 必须提交 | 禁止提交 |
| --- | --- | --- |
| `scene://`（含协议中的 environment 角色） | `objectId`、`sceneCard`、`identityAnchors`、`prohibitedDrift` | `identityBoardSpec`、顶层 `prompt`、顶层 `negativePrompt` |
| `character://` | `objectId`、`prompt`、`negativePrompt`、`identityAnchors`、`prohibitedDrift` | `sceneCard` |
| `prop://` 等其它 | `objectId`、`prompt`、`negativePrompt`、`identityAnchors`、`prohibitedDrift` | `sceneCard`、`identityBoardSpec` |

`role` 由宿主从 `objectId` 指向的 `objectRegistry[]` 项编译，作者只写 `objectId`，不写 role、不写身份字符串。人物四视图只属于 character 项。

## 场景项的唯一可执行写法

可执行空间描述写入 `sceneCard.spacePrompt`，同图排除项写入 `sceneCard.negativePrompt`；**不提交通用顶层 `prompt/negativePrompt`**，以免剧情表演描述直接流入生图。投影器只把这两个已创作字段逐字映射为图片执行字段，不生成或改写语义。

`sceneCard` 是**对象**，不是字符串，必须同时给出以下全部字段：

```json
"sceneCard": {
  "spacePrompt": "<无人物理空间的可执行图片提示词>",
  "negativePrompt": "<本张纯空间参考图的排除项>",
  "sceneProfileVersion": "scene-card/v1",
  "sceneAssetRole": "space_anchor",
  "sceneOccupancy": "none",
  "sceneLightingSpec": {
    "version": "scene-lighting/v1",
    "narrativeIntent": "<观众应先读到什么，以及暗部保留什么>",
    "keySource": "<物理来源>",
    "direction": "<方向、高度与遮挡>",
    "colorTemperature": "<有意义的色温关系>",
    "lightQuality": "<硬柔、扩散、对比与暗部可读性>",
    "shadowBehavior": "<阴影方向、边缘与落点>",
    "atmosphereInteraction": "<介质如何接光；无依据时写 none>",
    "reflectiveBehavior": "<关键材质的反射/高光行为>",
    "practicalSources": ["<画内可见或可推断灯具>"],
    "continuityLocks": ["<跨镜必须保持的灯光状态>"]
  }
}
```

三个枚举字段逐字写死：`sceneProfileVersion="scene-card/v1"`、`sceneAssetRole="space_anchor"`、`sceneOccupancy="none"`。`sceneLightingSpec` 的 9 个文本字段与 2 个数组都不得为空；`practicalSources` / `continuityLocks` 是字符串数组，不是字符串。

`identityAnchors` 只记录空间锚，`prohibitedDrift` 只记录空间不变量，宿主逐字投影为 `sceneAnchors/prohibitedSceneDrift`。场景项不提交 `identityBoardSpec`。

## 场景资产的职责边界

场景卡是**无人空间**资产，不是剧情删改：不出现人物、人群、人体局部、倒影或剪影。人物占用、拥挤、交战、表演与姿态留在 BeatSheet 的 `storyEvents` 与对象状态里，由 clip writer 写进视频提示词。人物调度只用来推导空地尺度、入口、通道、遮挡、视线与固定物件落位，不复制进空间描述。人多不意味着空间狭窄、建筑破旧或环境脏乱，禁止用无来源的空间改造替代人群语义。

`spacePrompt` 必须明确写成纯空间参考图，并包含"画面中无人、无人物、无群演、无路人、无人体局部、无人物倒影/剪影"等同义排除事实；不得依赖 `negativePrompt` 单独承担这一语义。

会被拿取、交接、操作、损坏、变形或跨场景复用的独立物体交给 `tapcanvas-prop-card` 建立 `prop-card/v1`；场景卡只记录它在空间中的固定落位。

## 被拒时怎么办

本合同的校验是结构性的：字段缺失、类型不符、枚举不等于约定值，都会沿现有结构化输出修复链退回同一作者修订。修订时**补齐结构**，不要改写来源事实，也不要用执行层补一句无人要求代替这份合同。
