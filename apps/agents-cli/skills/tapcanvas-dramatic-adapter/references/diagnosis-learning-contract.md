# 诊断与学习合同

## 诊断对象

一次生产的完整证据链是：

```text
source chapter
-> dramatic BeatSheet
-> per-clip writer artifacts
-> rendered assets and final video
-> AI diagnosis
-> explicit human feedback / behavior outcome
```

诊断必须区分出生层：

- 源故事缺少可用事件：报告素材限制，不虚构大情节。
- BeatSheet 缺目标、选择、债务或兑现：修章级改编器。
- BeatSheet 正确但 shots 没拍出：修 writer/specialist。
- prompt 正确但生成资产漂移：归因模型、参考资产或生成合同。
- 成片正确但观众反应弱：形成待验证的 taste 假设，不能直接覆写 skill。

## 每次诊断记录

记录真实标识和不可覆盖的摘要：`projectId/chapterId/runId/clipIndex/sourceHash/beatSheetHash/writerArtifactHash/assetUrls/model/loadedSkills/diagnosticVersion`。对每个发现记录：

```text
claim: 观察到了什么
evidence: 对应原文、合同、trace、产物或用户反馈
birthStage: source | beat_sheet | writer | generation | edit | audience
confidence: low | medium | high
proposedChange: 候选改法
counterexampleRisk: 会伤害哪些题材或反例
```

没有 evidence 或无法定位 birthStage 的结论不进入学习候选。

## 从一次案例到系统知识

1. 单次案例只生成 `candidate`，保留 provenance，不修改仓库 skill。
2. 候选至少跨三个独立 run 重复出现，并包含一个反例检查，才可进入 `validated`。
3. 比较修订前后产物时，优先使用盲评和用户明确反馈；AI 自评分只能作辅助诊断。
4. `validated` 规律仍需人审，才能进入 skill/reference 或知识卡；原案例和失败样本继续保留。
5. 新规则必须说明适用边界和可能退化的题材。无法说明边界的经验不能晋升。

## 评估维度

- 因果可读性：不看分析，能否从画面理解目标、判断、选择和后果。
- 状态变化密度：有效变化而非镜头数量。
- 情绪有效性：情绪是否改变行动，而非仅增加表情。
- 兑现质量：期待、兑现、反应与余波是否闭合。
- 追看问题：结尾是否形成具体未解问题。
- 源事实完整性：关键事实是否被篡改。
- 套路风险：规则是否把不同题材压成同一种爽文。

学习系统优化这些维度的真实改进，不优化单一“张力分”。
