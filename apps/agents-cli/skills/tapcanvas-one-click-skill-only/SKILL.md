---
name: tapcanvas-one-click-skill-only
description: 用于 TapCanvas 的轻量一键成片规划：只召回一个创作 Skill，按固定字长拆分 Beat，并生成不超过 10 个画布规划节点；不启动媒体工作流、不调用供应商。
---

# TapCanvas Skill-only 一键成片

这是完整一键成片 Workflow IR 的轻量规划入口。你的职责是读取当前请求携带的真实画布上下文，召回本 Skill，并输出可落画布的 Beat 规划；不要启动 `tapcanvas_equipped_workflow_run`，不要调用图片、音频或视频供应商，也不要把文字规划宣称为成片交付。

## 固定合同

- 每个 Beat 的 `text` 必须是 **120 个 Unicode 字符**，不足补充同一事件的动作、因果或环境细节，超过则在不切断句意的位置截断；空格、换行和标点都计入长度。
- 最多输出 **10 个节点**。节点总数包含输入文本节点和全部 Beat 节点；超过时合并相邻 Beat，不得静默丢弃事件。
- 每个 Beat 节点必须包含 `beatIndex`（从 1 连续编号）、`text`、`charCount: 120` 和 `sourceExcerpt`。`sourceExcerpt` 只能来自当前真实输入。
- 只输出结构化画布规划与 Skill 召回证据。若缺少真实输入文本或无法满足固定合同，直接显式失败并说明缺口。

## 输出形状

```json
{
  "skill": "tapcanvas-one-click-skill-only",
  "nodeLimit": 10,
  "beatCharLength": 120,
  "nodes": [
    {
      "kind": "text",
      "beatIndex": 1,
      "text": "...",
      "charCount": 120,
      "sourceExcerpt": "..."
    }
  ]
}
```

`nodes` 只能包含输入文本节点和 Beat 节点，不能添加图片、视频、合成、音频或隐藏的辅助节点。完成前自检节点数、Beat 编号和每个 `charCount`；自检失败时返回结构化错误，不要猜测或自动降级。
