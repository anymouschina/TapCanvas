---
name: tapcanvas-continuity
description: 处理章节分镜续写、storyboardChunks、tailFrameUrl 与连续性审查，确保续写边界与尾帧承接可追溯。
---

# TapCanvas Continuity

## 何时使用

- 用户要求续写当前章节分镜
- 用户要求承接上一镜头、上一组分镜或尾帧
- 主代理需要核对 storyboard continuity 与章节边界

## 输入证据

- 当前章节正文
- `storyboardChunks`
- `tailFrameUrl`
- continuity / source bundle / node context 工具结果
- continuationAnchor 或 selectedReference

## 执行原则

- 续写边界必须来自显式 checkpoint，不得靠历史文本猜
- 缺 `tailFrameUrl`、缺 chunk 边界、缺章节正文时直接失败
- 连续性判断基于实时工具结果，不基于 docs/assets/ai-metadata
- 对小说单视频或章节续写请求，若当前还没有显式 chunk/shot checkpoint，应先继续读取书籍索引、章节正文、source bundle、node context 与 continuity 证据缩小范围，而不是立刻退回让用户补全所有锚点
- 如果只是诊断连续性，清楚列出冲突点与缺失证据
- 本 skill 是连续性协议层：负责规定必须读取哪些状态、哪些字段是 source of truth、何时必须失败
- 若需要拆子代理，子代理只做局部任务，不得形成第二套连续性工作流

## 子代理边界

- 主代理 / 主 skill 负责：
  - 读取 `storyboardChunks`、`tailFrameUrl`、章节正文、当前节点上下文
  - 判断这次属于续写、重做、连续性修复还是新起场景
  - 决定是否调用子代理
  - 汇总结果并写回统一连续性结论
- 子代理只允许承担局部职责，例如：
  - 提取当前章节/当前组的剧情事实
  - 审查上一组末状态与当前目标是否冲突
  - 基于已确认事实拆镜头或整理提示词 brief
- 子代理不得：
  - 自己决定 source of truth
  - 自己绕过 checkpoint 继续生成
  - 自己写出另一套独立 continuity 规则
  - 用 history/recentShots 取代显式 chunk checkpoint

## 输出契约

- 续写时，明确本轮承接的章节、chunk、尾帧与镜头锚点
- 若发现冲突，列出：
  - 冲突点
  - 影响范围
  - 需要补读的实时数据
- 若可以继续，给出基于证据的续写建议或下一步计划
