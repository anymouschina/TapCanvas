---
name: tapcanvas-video-prompt-governance
description: 治理 TapCanvas 视频提示词权威合同及其 writer、reviewer、领域 Skill 与知识输入的一致性。新增或更新视频提示词 Skill、导演方法、Seedance 方法、提示词知识卡、审核标准、结构字段或 provider 规则时必须使用；把新知识拆成合同升级、领域扩展、动态供应商事实或非阻塞经验，生成可审查 diff、reviewer 映射、eval 方案并运行结构一致性审计。
metadata:
  contracts:
    - tapcanvas/video-prompt-authoring@4.0.0
---

# TapCanvas 视频提示词合同治理

## 目标

维护一份权威 authoring contract，让 writer 与 reviewer 读取同一维度、同一 owner 和同一版本。领域 Skill 负责提供方法，不再复制“最终提示词标准”；Hono/Web 只做确定性协议校验，不接管语义质量。

权威合同固定在：

`apps/agents-cli/skills/tapcanvas-video-prompt-writer/references/authoring-contract-v1.json`

开始治理前完整读取权威合同 reference。修改正式 writer 或 reviewer 时，先读取两者骨架，再按本次变更涉及的 dimension、字段与复盘项精确读取对应标题单元；涉及整体生产范围时再按阶段读取 `tapcanvas-video-workflow` 的对应标题单元。禁止为了“完整”把三份大型 Skill 全文常驻到同一模型窗口。

## 知识拆解

把每条新知识先原子化为：

```json
{
  "claimId": "稳定 ID",
  "source": "skill、用户反馈、真实 run 或外部方法来源",
  "evidence": "可追溯证据",
  "appliesTo": "跨题材、特定题材、特定模型或仅展示",
  "proposal": "它要求 authoring 改变什么"
}
```

再只允许归入以下一类：

1. `universal_contract_upgrade`：跨题材、跨模型成立，现有维度无法完整表达；才允许升级合同版本。
2. `domain_extension`：只适用于战斗、文戏、TVC、情绪、转场等领域；映射到现有 `dimensionId`，放 writer reference 或对应领域 Skill，不扩核心字段。
3. `provider_fact`：时长、分辨率、引用数、原生音频等能力；只由实时 `generationContract` 提供，禁止写死进 authoring contract。
4. `presentation_projection`：13 列表、UI 卡片、日志标签等展示形式；由 renderer/UI 投影，不改变 writer JSON。
5. `non_blocking_heuristic`：案例经验、审美倾向、推荐词汇；可参与 agent 复盘，但不形成最低字数、评分、关键词或运行时门禁。
6. `conflict_or_reject`：与用户事实、动态模型合同、付费幂等、真实资产或现行权威合同冲突；记录冲突，不静默合并。

## 映射与升级规则

- 优先映射现有 `dimensions[].id`。只有无法表达跨题材必要信息时，才提议新增维度或字段。
- writer 输出字段和 reviewer 检查项都引用同一个 `dimensionId`；reviewer 不重抄第二份规范，也不依赖退役 Skill。
- 通用合同只定义信息维度、owner、字段落点和复盘问题，不规定题材答案。战斗力度、文戏克制、TVC 卖点等留在领域 extension。
- 用户本轮事实与真实项目状态优先；动态 generationContract 管供应商硬边界；authoring contract 管创作信息结构；领域 extension 管方法；heuristic 只作建议。
- 用户明确指定的节奏、密度、收束和结果边界优先于所有默认叙事模板。钩子、悬念、余波、呼吸点、高潮前抽空、收束或未决结果都必须有用户或权威来源依据；没有依据时，结构字段应明确表达“不适用”（例如可空字段使用 `null`），不得为了填满模板而杜撰。
- 创作复盘发生在 writer 同一执行链并直接修订首稿。合同与 reviewer 都不得成为 Hono/Web 的语义质量门禁，也不得拦截、回滚或丢弃已受理媒体。
- 版本升级只允许显式 `major/minor/patch`：删字段或改 owner 为 major，新增可选维度为 minor，措辞澄清与 consumer 修复为 patch。
- `temporalFrameTrack + temporalFrameCoverage` 是 1.3.0 的通用合同升级：它把“信息密度”定义为每个不超过 1 秒时间窗的起帧、可见过渡、承帧与真实镜头映射，不把视频模型内部实现臆测成供应商事实，也不把该规则转换为字符数、固定 shot 数、关键词或 Hono/Web 语义评分门禁。

## 交付格式

先输出并审查变更提案，再修改文件：

```json
{
  "baseContract": "tapcanvas/video-prompt-authoring@4.0.0",
  "claims": [],
  "mappings": [
    {
      "claimId": "claim-id",
      "classification": "domain_extension",
      "dimensionIds": ["action_causality_physics"],
      "targetFiles": [],
      "reason": "为何不升级核心合同"
    }
  ],
  "contractChanges": [],
  "writerChanges": [],
  "reviewerChanges": [],
  "conflicts": [],
  "evalCases": []
}
```

用户已授权落地时，按顺序执行：

1. 更新权威合同及版本。
2. 更新 writer 对相应维度的创作行为。
3. reviewer 只更新 dimension 映射或复盘问题，不复制 writer 方法全文。
4. 更新领域 Skill 的 `extends` 边界；删除其“全局权威”“最终标准”声明。
5. 为真实失败模式添加 eval；不得只添加一个特定章节或特定 prompt 的 case 分支。
6. 结构变化先运行 `node apps/agents-cli/skills/tapcanvas-video-prompt-governance/scripts/audit-contract-consistency.mjs`；它只验证 JSON 形状、版本声明、消费者、角色装配和退役状态。
7. 任何 writer/reviewer 语义变化必须使用 `skill-creator` 的盲评流程执行 `authoring-contract-v1.json.evaluationPolicy.semantic.suitePath`：同一批输入分别运行 current/candidate，由继承同模型配置的 LLM judge 按 `dimensions[].reviewerChecks` 出具 `AgentEvaluationResultV1`，再做 blind comparison。禁止用正则、关键词命中或 SKILL.md 固定句子代替 LLM judge。
8. 运行 `node apps/agents-cli/scripts/audit-skills.mjs`、TypeScript 与相关结构测试；这些测试不得声称验证了创作语义。

## 测试职责分层

| 测试层 | 允许验证 | 禁止验证 |
|---|---|---|
| deterministic | JSON 可解析、dimension ID 唯一、必需字段、合同版本、Skill `metadata.contracts` 声明、role skillBundle、退役状态、文件存在 | 忠实度、因果清晰度、人物状态是否合理、旁白必要性、镜头质量、审美 |
| agents_judge | `reviewerChecks` 对真实 current/candidate 输出的语义判断，附 rationale 与 evidence | 充当生产运行时门禁、拦截已受理媒体 |
| human | 用户对成片与提示词的明确反馈，作为下一轮知识证据 | 被自动改写成普适铁律 |

LLM eval 结果是离线治理证据，不是运行时 pass/fail。若 candidate 退化，保持当前合同版本并记录失败维度；若提升，只把可迁移的结论映射回维度或领域 extension，禁止把评测样例原句写进生产分支。

## 边界

- 不从 `docs/`、`assets/`、`ai-metadata/` 装配运行时知识；要采用的方法必须沉入 Skill 或其 `references/`，并保留 provenance。
- 不自动修改用户手写知识或未授权资产；治理变更进入工作树供人审。
- 不以正则/关键词替代 agent 的语义分类或质量评测。审计脚本只读取 JSON 与 Skill frontmatter 的显式结构声明；SKILL 正文措辞不属于机器测试 API。
- 不创建平行 reviewer、第二套 prompt schema 或 provider 专用最终合同。
