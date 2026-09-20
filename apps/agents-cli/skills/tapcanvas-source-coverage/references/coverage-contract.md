# Source Coverage Contract v1

## 1. 合同用途

`tapcanvas-source-coverage/v1` 只证明已声明来源范围是否进入可回查证据链。它不证明模型理解正确、引用支持结论、作品质量优秀或商业判断成立。

## 2. 账本结构

```json
{
  "version": "tapcanvas-source-coverage/v1",
  "expectedDelivery": "完整分析用户提供的第一章正文",
  "sources": [
    {
      "sourceId": "book:demo:chapter:1:sha256:...",
      "label": "第一章",
      "unit": "characters",
      "expectedRange": { "start": 0, "end": 12640 },
      "coveredRanges": [
        {
          "start": 0,
          "end": 6400,
          "evidenceIds": ["toolu_read_chunk_01"]
        },
        {
          "start": 6200,
          "end": 12640,
          "evidenceIds": ["toolu_read_chunk_02"]
        }
      ],
      "failedRanges": []
    }
  ]
}
```

## 3. 字段约束

### 顶层

- `version`：只能是 `tapcanvas-source-coverage/v1`。
- `expectedDelivery`：非空字符串，描述用户真实要求；不能写成内部步骤。
- `sources`：至少一个来源。

### source

- `sourceId`：非空且在本轮唯一。应包含 URL、资产 ID、节点 ID、章节 ID、文件版本或 hash 中至少一种真实身份。
- `label`：可选的人类可读名称，不参与唯一性判断。
- `unit`：`characters | paragraphs | pages | seconds | items` 之一。
- `expectedRange`：半开区间 `[start,end)`，`end` 必须大于 `start`。
- `coveredRanges`：真实成功读取的半开区间。范围可重叠，校验时会合并。
- `failedRanges`：可选；记录已尝试但失败的区间与原因。它不计入覆盖。

### covered range

- `start/end`：有限数值，必须落在 `expectedRange` 内且 `end > start`。
- `evidenceIds`：至少一个非空字符串。可以是工具调用 ID、持久结果 ID、文件读取证据 ID；不能是模型自造的 chunk 名。
- `chunkId`：可选，仅用于追踪，不替代 `evidenceIds`。

### failed range

- `start/end`：应落在 expected range 内。
- `reason`：非空、可操作的真实失败原因。
- 失败区间即使与 covered range 重叠，也必须保留；最终由领域流程说明重试后哪个证据取代了失败。

## 4. 区间与状态算法

校验器会：

1. 按 start 排序 covered ranges；
2. 合并相交和首尾相接区间；
3. 从 expected range 中扣除合并区间得到 `gaps`；
4. 检查越界、空区间、重复 sourceId 和空 evidenceIds；
5. 输出每个来源及整体状态。

状态含义：

- `complete`：合同有效，所有来源的 expected range 无 gap；
- `partial`：合同有效，但至少一个来源有 gap；
- `invalid`：合同结构或区间不合法，不能据此判断覆盖；
- `unverifiable`：由 agent 在无法取得总范围时使用。由于此时不能形成有效 expected range，不应伪造账本交给校验器求 complete。

## 5. 领域结论如何绑定

覆盖账本之外，领域报告中的关键结论仍应保留自己的证据关系：

```text
claimId → sourceId + sourceAnchor + evidenceId → observation/inference
```

- `observation`：来源直接可见或可读；
- `inference`：agent 基于一个或多个 observation 的解释；
- `unknown`：证据不足。

区间覆盖完整不代表每条 inference 都成立。领域 skill 必须另行检查证据是否真的支持结论。

## 6. 交付模板

```text
coverageContract: tapcanvas-source-coverage/v1
expectedDelivery: ...
deliveryEvidence:
  sources: ...
  validatorExitCode: 0 | 1 | 2
  coverageStatus: complete | partial | invalid | unverifiable
deliveryVerification:
  rangeCoverage: satisfied | unsatisfied | unverifiable
  semanticReview: satisfied | unsatisfied | not-run
  missingRanges: ...
  limitation: 结构覆盖不等于语义正确
```

如果用户只要求部分范围，应该在 `expectedDelivery` 和 `expectedRange` 中如实缩小范围，而不是让校验器对全量范围失败后再把 partial 美化为 complete。

## 7. SourceLineageV1 生产谱系映射

`tapcanvas-source-coverage/v1` 适合独立只读审计；需要把来源覆盖、生产阶段和真实资产绑定到同一逻辑任务时，使用 `tapcanvas-source-lineage/v1`：

```json
{
  "version": "tapcanvas-source-lineage/v1",
  "lineageId": "chapter-12-video",
  "taxonomyId": "tapcanvas-video-production",
  "taxonomyVersion": "1",
  "expectedDelivery": "将第十二章制作成完整视频",
  "requirementIds": ["must-deliver-video"],
  "sources": [
    {
      "sourceId": "book:demo:chapter:12:sha256:...",
      "label": "第十二章",
      "categoryId": "chapter_text",
      "requirementLevel": "required",
      "unit": "characters",
      "versionRef": "sha256:...",
      "expectedRange": { "start": 0, "end": 12640 }
    }
  ],
  "nodes": [
    {
      "nodeId": "phase:storyboard",
      "level": "phase",
      "categoryId": "storyboard_production",
      "requirementLevel": "required",
      "parentNodeId": null,
      "upstreamNodeIds": [],
      "sourceAnchors": [
        {
          "sourceId": "book:demo:chapter:12:sha256:...",
          "range": { "start": 0, "end": 12640 },
          "evidenceIds": ["tool:chapter-read:12"]
        }
      ],
      "outputRefs": [],
      "attributes": {}
    },
    {
      "nodeId": "artifact:final-video",
      "level": "artifact",
      "categoryId": "video_asset",
      "requirementLevel": "required",
      "parentNodeId": "phase:storyboard",
      "upstreamNodeIds": [],
      "sourceAnchors": [],
      "outputRefs": ["https://assets.example/final.mp4"],
      "attributes": {}
    }
  ]
}
```

三种维度不得混用：

- `level` 是固定结构分级：`collection | phase | unit | artifact`；
- `categoryId` 是开放业务分类，由 `taxonomyId + taxonomyVersion` 解释；runtime 不做语义路由；
- `requirementLevel` 是完整性权重：`required | supporting | optional`。

required 来源必须有可验证的 `expectedRange`，required 节点必须能沿自身 anchor、parent 或 upstream 追溯到来源，required artifact 必须有 `outputRefs`。supporting/optional 缺口仍持久化，但不把整体状态降为 partial。`source_lineage_record` 会把每个内容变化追加成新 revision；完全相同的 fingerprint 重放返回原 revision。其 persisted-state evidence 始终投影 `deliveryRole=supporting_evidence` 与 `verificationStatus=unsatisfied`：coverage complete 只证明结构追溯完整，不能替代真实媒体/画布交付证据，也不取得媒体回滚或用户任务终止权。

## 8. 生产工具自动回执

生产工具可以在成功的结构化返回根级附加：

```json
{
  "ok": true,
  "assetId": "asset:final-video:12",
  "sourceLineageReceipt": {
    "version": "tapcanvas-source-lineage-receipt/v1",
    "receiptId": "video-render:chapter-12:v1",
    "lineage": {
      "version": "tapcanvas-source-lineage/v1",
      "lineageId": "chapter-12-video",
      "taxonomyId": "producer-owned-taxonomy",
      "taxonomyVersion": "1",
      "expectedDelivery": "将第十二章制作成完整视频",
      "requirementIds": ["must-deliver-video"],
      "sources": [
        {
          "sourceId": "chapter:12:sha256:abc",
          "label": "第十二章",
          "categoryId": "chapter_text",
          "requirementLevel": "required",
          "unit": "characters",
          "versionRef": "sha256:abc",
          "expectedRange": { "start": 0, "end": 12640 }
        }
      ],
      "nodes": [
        {
          "nodeId": "artifact:final-video",
          "level": "artifact",
          "categoryId": "video_asset",
          "requirementLevel": "required",
          "parentNodeId": null,
          "upstreamNodeIds": [],
          "sourceAnchors": [
            {
              "sourceId": "chapter:12:sha256:abc",
              "range": { "start": 0, "end": 12640 },
              "evidenceIds": ["chapter-read:12"]
            }
          ],
          "outputRefs": ["asset:final-video:12"],
          "attributes": {}
        }
      ]
    }
  }
}
```

真实回执必须提交完整有效的 SourceLineageV1。runtime 只读取根级精确字段 `sourceLineageReceipt`，不会扫描嵌套响应、prompt、URL 或工具名猜测谱系。成功投影会为每个 source anchor 追加 `tool-receipt:<receiptId>`，同一 receiptId 与同一 fingerprint 幂等；相同 receiptId 内容漂移必须显式 diagnostic。

自动投影发生在真实工具动作成功之后。无效回执不能把工具改判失败，也不能删除、覆盖或回滚已经生成的资产；agent 应依据 diagnostic 修复回执或手工追加正确 revision，并复用已有 outputRef，禁止再次调用付费生成。
