import type { SceneReferenceCard } from "../../../../../packages/schemas/scene-reference-contract/index.mjs";

export const sceneReferenceFixture: SceneReferenceCard = {
  "spacePrompt": "无人空间参考图，固定入口和过道",
  "negativePrompt": "人物、人群及人体倒影",
  "sceneProfileVersion": "scene-card/v1",
  "sceneAssetRole": "space_anchor",
  "sceneOccupancy": "none",
  "sceneLightingSpec": {
    "version": "scene-lighting/v1",
    "narrativeIntent": "展示空间纵深",
    "keySource": "侧窗天光",
    "direction": "画面右侧",
    "colorTemperature": "中性日光",
    "lightQuality": "柔光",
    "shadowBehavior": "阴影向左",
    "atmosphereInteraction": "none",
    "reflectiveBehavior": "金属受控反光",
    "practicalSources": [],
    "continuityLocks": [
      "侧窗光向"
    ]
  }
};
