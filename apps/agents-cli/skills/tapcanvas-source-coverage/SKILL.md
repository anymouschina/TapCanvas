---
name: tapcanvas-source-coverage
description: TapCanvas 长材料证据覆盖与交付核验协议。分析小说全文、长章节、多文件、字幕、访谈、视频时间轴或任何需要声称“完整看过/全量覆盖”的来源时使用；也用于复核分块分析是否漏段、重叠结果是否重复、部分失败是否被误报成完成。只验证来源范围、证据锚点与覆盖状态，不用关键词或正则替 agents 判断内容语义，也不替代具体的研究、审稿、IP 筛选或导演拆解 skill。
disable-model-invocation: false
category: 系统/元
decision-basis-role: evidence_only
related-skills:
  - tapcanvas-research
  - tapcanvas-chapter-review
  - tapcanvas-ip-screening
  - tapcanvas-reference-work-analysis
consumes:
  - 带稳定身份与明确分析范围的长文本、字幕、文件集合或视频时间轴
  - 各分块真实工具调用、读取结果或可回查来源锚点
produces:
  - tapcanvas-source-coverage/v1 区间账本，或绑定逻辑任务的 tapcanvas-source-lineage/v1 谱系 revision
  - complete、partial 或 unverifiable 的结构覆盖结论，以及按层级、开放分类和重要度汇总的诊断
required-evidence:
  - 每个来源的 sourceId、计量单位与 expectedRange
  - 每个已覆盖区间对应的真实 evidenceIds
  - 所有缺口、读取失败与主动排除范围的明确记录
side-effects:
  - 可通过 source_lineage_record，或消费生产工具显式返回的 sourceLineageReceipt，追加持久化谱系 revision 并绑定当前 LogicalTaskGraphV2 输入引用；不修改来源、画布、项目文件或生产资产
runtime-tools:
  - source_lineage_record
  - source_lineage_get
  - source_lineage_list
self-check:
  - 每个“全文、全片、全部文件或完整覆盖”声明都必须有同范围 expectedRange 与无缺口校验结果支撑
  - coveredRanges 只能来自真实读取或工具结果；计划、占位、摘要和模型记忆不能充当 evidenceIds
  - 分块大小与重叠由真实工具限制和自然边界决定，不能用固定字数截断后静默丢弃尾部
  - 重叠区的重复结论必须按来源锚点合并，不能被计为两份独立证据
  - 任一范围失败或证据不可回查时必须输出 partial 或 unverifiable，并保留已完成部分
  - 结构校验通过只证明区间覆盖，不得被描述成语义结论正确、作品质量优秀或市场判断成立
  - 执行型任务由 runtime 的 expectedDelivery、deliveryEvidence、deliveryVerification 链验收；不得要求用户可见正文机械复述内部合同字段
---

# TapCanvas Source Coverage

## 使命

你是来源覆盖审计员，不是内容结论的裁判。你的职责是回答一个更基础的问题：**这次分析声称覆盖的材料，是否真的都进入了可回查的证据链？**

完整不是“模型说看完了”，而是声明范围、实际读取范围和交付结论三者能逐段对账。语义判断仍由调用本 skill 的研究员、审稿人或导演完成；本 skill 不根据文本表面特征决定情节、价值或风险。

## 成功标准

- 每个来源都有稳定 `sourceId`、唯一计量单位和明确 `expectedRange`；
- 每个 `coveredRange` 都绑定真实 `evidenceIds`，后来的人能回到读取结果或工具调用；
- 分块并集覆盖声明范围，重叠与缺口都可计算；
- 读取失败、不可访问和主动缩小范围不会被“总结得很完整”掩盖；
- 最终状态只表达覆盖事实，不越权证明内容结论质量；
- 用户要求的交付范围与 coverage verifier 实际核验范围一致。
- 交付由 runtime 的 `expectedDelivery -> deliveryEvidence -> deliveryVerification` 链明确收口；用户可见正文只需忠实报告结果与限制，不机械泄露内部账本。

## 操作回环

### 1. 先锁定期望交付范围

把用户要求编译成 `expectedDelivery`：来源有哪些、每个来源从哪里到哪里、最终是否允许部分交付。不要先分块再反推范围；那会让未读取的尾部从合同里消失。

范围以真实材料支持的单位表达：

- 文本优先字符偏移、段落号或页码；
- 字幕与视频使用秒或稳定时间码；
- 多文件集合使用文件清单加每个文件自己的范围；
- 离散记录使用 item index。

同一来源只能使用一种单位。无法知道总长度或总时长时，把状态设为 `unverifiable`，先取得真实元数据；不得用估计值制造完整范围。

### 2. 记录来源身份

为每个来源记录能防止串片、串章或版本漂移的身份：真实 URL、节点 ID、文件路径、内容 hash、章节 ID、资产 ID 或工具返回的等价标识。标题和用户口头简称只能作标签，不能单独证明是哪一版来源。

来源在处理中发生变化时，创建新 `sourceId` 或版本，不把新旧范围合并成同一账本。

### 3. 规划分块

先服从真实工具的上下文、字节、时长和文件限制，再沿自然边界切分。重叠只解决跨边界连续性，长度取决于任务所需上下文，不采用固定“200 字”或固定百分比。

计划必须覆盖全部 `expectedRange`。并发数限制只能控制批次，不能把后续块从计划中删除；本轮资源不足以完成时，交付已完成块并显式标为 `partial`。

### 4. 建立证据账本

每个成功读取区间记录：

- `start/end`；
- 对应 `evidenceIds`；
- 可选的 chunk ID 与来源锚点；
- 读取失败则进入 `failedRanges`，不能进入 `coveredRanges`。

重叠块出现相同结论时，按来源锚点和事实对象合并。两个 chunk 都提到同一句，不等于两份独立证据。

### 5. 运行结构校验

完整读取 `references/coverage-contract.md`，按其中 JSON 合同组装账本。将账本传给：

```bash
node apps/agents-cli/skills/tapcanvas-source-coverage/scripts/validate-coverage.mjs <ledger.json>
```

也可从 stdin 验证：

```bash
node apps/agents-cli/skills/tapcanvas-source-coverage/scripts/validate-coverage.mjs -
```

退出码 `0` 表示声明范围在结构上完整覆盖；`1` 表示合同有效但存在缺口；`2` 表示账本本身无效。校验器只合并数值区间、检查边界和证据 ID，不读取正文、不判断语义。

### 6. 形成交付验收

按三层链路收口：

1. `expectedDelivery`：用户要求覆盖哪些真实来源与范围；
2. `deliveryEvidence`：真实读取、工具调用和区间账本；
3. `deliveryVerification`：结构校验结果，以及具体领域 skill 对语义产物的自检结果。

只有三者范围一致且 coverage 状态为 `complete`，才能声称“完整覆盖”。结构完整但领域结论尚未复核时，只能说“来源区间已覆盖”，不能说“分析已经正确”。

在持久逻辑任务中，将生产谱系编译为 `tapcanvas-source-lineage/v1` 并调用 `source_lineage_record`。谱系采用三种彼此独立的维度：

- 结构层级固定为 `collection -> phase -> unit -> artifact`，只表达从材料集合到最终资产的生产粒度；
- `categoryId` 属于 `taxonomyId/taxonomyVersion` 指定的开放分类体系，由当前领域 agent/skill 声明，runtime 不维护关键词或别名表；
- 重要度固定为 `required | supporting | optional`。只有 required 来源、节点和 artifact 影响整体完整性，supporting/optional 的缺口只进入诊断。

每个 `sourceAnchor` 必须绑定真实 `evidenceIds`，每个 required artifact 必须有真实 `outputRefs`。所有 SourceLineage revision 都会被完整保留并产生 `deliveryRole=supporting_evidence`、`verificationStatus=unsatisfied` 的 persisted-state 证据：即使 coverage 为 complete，也只能证明结构追溯完整，不能单独证明视频/图片/画布已经真实交付。最终完成必须另有 settled tool call、真实资产 URL、节点或权威持久执行状态。谱系不删除、覆盖或拦截已经生成、已受理的媒体资产。后续修订继续调用 `source_lineage_record`，相同 fingerprint 幂等重放，内容变化才追加新 revision。需要读取完整结构时调用 `source_lineage_get`；`source_lineage_list` 只返回紧凑 revision 摘要，避免把长剧本谱系反复灌回模型上下文。

如果真实生产工具已经在成功 `structuredOutput` 根级返回 `sourceLineageReceipt@tapcanvas-source-lineage-receipt/v1`，agent-loop 会自动持久化并注入稳定的 `tool-receipt:<receiptId>` evidence；不要再调用 `source_lineage_record` 重复搬运同一谱系。只有工具没有声明该版本化字段、或工具明确返回投影 diagnostic 时才手工补录/修订。不得根据工具名、URL、prompt 或正文猜一个回执；回执无效属于后处理诊断，已成功媒体必须保留，只修复谱系并禁止重放生成动作。

用户可见答复不必逐字展示内部三层合同；通用 verifier 从持久 evidence 完成交付审计。若用户明确要求审计明细，再展示对应范围、缺口和 revision 引用。

## 决策规则

- **材料短且一次真实读取即可完整取得**：仍记录单一完整区间，不必人为分块。
- **来源只提供节选**：把节选本身声明为范围，可以完整分析“该节选”；不得升级成整章或整部作品结论。
- **一个来源失败，其他来源成功**：保留成功结果，整体状态为 `partial`，逐来源列出状态。
- **总范围未知**：状态为 `unverifiable`；先补元数据，不用“看起来到结尾了”推断完整。
- **用户只要抽样观察**：把抽样范围写进 `expectedDelivery`，不要假装抽样等于全量。
- **视频工具内部自动切段**：使用工具返回的真实总时长、分段数和全局时间锚；不能根据预设段长反推已经成功的分段。

## 边界与失败语义

- 不用正则、关键词频次、段落长度或固定阈值判断故事语义、风险、质量与市场价值。
- 不把计划、节点连线、`queued/running`、空响应、占位摘要或“agent completed”当成覆盖证据。
- 不因局部失败删除已成功分析的内容；把成功区间和失败区间一起交付。
- 不自动改写来源、不写画布、不保存项目；需要持久化时由上层 skill 取得授权并使用正式工具。
- 校验器失败时原样报告错误与缺口，修正账本后重跑；禁止手工把状态改成 complete。

## 收尾复查

1. 用户要求的来源、版本和范围是否与 `expectedRange` 一致？
2. 每个 covered range 是否有真实、可回查的 evidence ID？
3. 合并区间后是否仍有 gap、越界或空区间？
4. 重叠结论是否去重，而不是重复计证据？
5. `complete/partial/unverifiable` 是否忠实反映脚本结果与真实工具状态？
6. 最终文案是否把“结构覆盖”与“语义正确”明确分开？
7. 持久任务是否已用最新 SourceLineage revision 投影 deliveryEvidence，且 partial/unverifiable 仍被保留供同链修复？
8. 生产工具已有成功 sourceLineageReceipt 时，是否避免重复手工 record；回执失败时是否只修复谱系而没有重放已成功副作用？

## References

- 覆盖账本字段、区间约束与交付模板：`references/coverage-contract.md`
