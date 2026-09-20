# PlotPilot 到小T的戏剧系统映射

## 迁移目标

迁移的是可追溯的叙事状态合同，不是 PlotPilot 的小说字数规划、固定章节模板或正文生成流程。小T的最终介质是短时长视频 clip，因此每项状态必须能约束画面、声音、选择、因果或跨拍连续性。

## 已吸收的原理

| PlotPilot 原理 | 小T合同 | 视频化改造 |
| --- | --- | --- |
| Scene goal / transition | `dramaticChange`、`pacingDecision.handoffToNext` | 每拍只允许一个主要局面变化，交棒到下一拍 |
| Narrative debt | `payoff.debtId/lifecycleAction/eligibleFromClipIndex` | 债务跨拍有稳定身份；禁止提前、重复兑现或关闭后复活 |
| Causal edge | `essentialCausality + causalProvenance` | 每条不可删除因果绑定源事实或必要物理结果，推断不得伪装成事实 |
| Emotional residue | `emotionTurn.residueIn/residueOut` | 相邻拍逐字交棒，防止人物在切镜后无代价重置 |
| Reader/character knowledge | `audienceExperience` | 冻结 POV、信息差、揭示顺序和观众下一问题 |
| State evolution / idempotent reducer | `dramaticChange.stateTransitions[]`、`stateDelta`、`exitState` | 状态动作有唯一 ID、因果索引和 before/after；按拍重放并拒绝重复动作或断裂终态 |
| Idempotent reducer | append-only diagnostics 与 learning evidence | 学习记录不覆盖历史；无真实工具证据不允许形成候选 |

## 不照搬的部分

- 不使用章节字数、场景字数或固定幕结构决定 clip 数量。视频按局面变化和模型容量切拍。
- 不把叙事债务到期视为必须填坑。`abandon` 是显式创作选择；延期必须留下真实后续压力，不能用空文案冒充。
- 不用张力分数证明作品优秀。分数只能定位复核方向，真实改进证据来自 BeatSheet、writer 输出、资产、诊断和用户反馈的同 run 对照。
- 不在 Hono 中实现小说 SOP、题材路由或语义判断。agents-cli skill 负责创作决策；Hono 只校验结构、索引、事实来源和真实资产。
- 不让单 clip writer重写章级因果。writer只把冻结合同转成可见可听的演出事实。

## 经典感的最小因果链

每个有效 beat 至少形成：

```text
既有压力或期待债务
-> 角色在有限证据下作出判断
-> 作出不可撤回选择
-> 付出代价或改写控制权
-> 观众看见兑现/反转/余波
-> 新状态与情绪残留交给下一拍
```

“事件很多”“镜头很快”“特效很大”都不能替代这条链。安静场景只要改变判断、关系或选择，同样可以是高密度戏剧。

## 持续学习观察面

每次真实一键成片只从可追溯事实形成学习候选：

1. BeatSheet：债务生命周期、因果来源、情绪交棒、状态变化和节奏裁决。
2. Writer artifact：冻结合同是否被完整演出，是否发生提前兑现、事实升级、情绪重置或动作轮播。
3. 真实资产：关键帧和视频 URL、模型、clip/run 标识及最终状态。
4. AI 诊断：问题出生阶段、证据工具调用、反例风险和可复现的 proposed change。
5. 用户反馈：明确喜欢/不喜欢的是哪一拍、哪种体验及原因，不能把“生成成功”当质量认可。

单 run 只能形成 candidate。至少三个独立真实 run、反例证据和用户明确批准后，才可 `validated`；下一次生产必须记录实际采用的 candidate ID，才能证明学习进入了创作链。

## 诊断问题分类

- `beat_sheet`：债务、因果、节奏、情绪或揭示顺序在 writer 前已错。
- `writer`：章级合同正确，但单 clip 没有把选择、后果或余波拍出来。
- `keyframe`：剧本正确，但构图没有表达权力关系、空间压力或关键证据。
- `video_prompt`：关键帧正确，但动作、摄影、声音或容量描述失真。
- `generation`：提示词合同正确，真实模型产物仍发生漂移、抖动、漏演或音画错误。
- `assembly`：单 clip 成立，但跨 clip 节奏、顺序、音频或结尾钩子在拼接后失效。

候选规则必须出生在真实问题所在层。禁止把生成模型偶发失败上升为 BeatSheet 方法论，也禁止用 writer 补丁掩盖章级债务或因果错误。
