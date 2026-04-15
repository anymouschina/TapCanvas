# Public Chat To Codex-Main Alignment Checklist

## 目标

- 将当前 `POST /public/chat -> hono-api bridge -> agents-cli /chat` 的重业务桥接链路，逐步收敛到更接近 `apps/codex-main` 的通用 thread/turn/item 执行范式。
- 保留 TapCanvas 必需的业务专属工具、token/计费/权限边界、结构化协议校验与持久化能力，但移除前端与 `hono-api` 对语义路由、SOP、固定执行链和完成态判断的过度接管。
- 将业务方法论、chapter-grounded 创作策略、prompt specialist 规则、团队编排默认策略，尽量下沉到 `apps/agents-cli` 的 skill / agent loop / completion verifier 内。
- 明确采用“语义决策下沉，业务执行留在业务层”的分层，而不是把所有能力机械迁移到 `agents-cli`。

## 职责分层基线

### 必须保留在业务层的职责

- 业务专属工具执行
  - 例如创建节点、连边、写 flow、查项目/书籍/章节/素材、登记资产结果、同步任务状态。
- token、厂商密钥、用户权限、计费额度、配额与审计。
- 所有要求强一致持久化、用户隔离、服务端校验的读写。
- 结构化协议校验
  - 例如画布 patch schema、生成合同、业务工具入参与返回值校验。

### 应优先下沉到 agents-cli 的职责

- 用户意图识别。
- 要不要读哪些业务上下文。
- 是否需要 team / specialist / 分阶段执行。
- 如何拆任务、何时继续、何时停止、何时显式失败。
- 创作方法论、chapter-grounded continuity 方法、prompt specialist 策略。
- 面向用户目标的完成态判断。

### 推荐交互模式

- `agents-cli` 负责决定“做什么”与“下一步调用什么能力”。
- `hono-api` 负责安全地执行“能做什么”，并返回事实结果。
- 前端负责展示 turn/item 过程与最终结果，不承担语义路由。

## 现状核心偏差

### 1. 入口层不是通用 turn 协议，而是业务代理入口

- 当前 `public/chat` 先在 `apps/hono-api/src/modules/apiKey/apiKey.routes.ts` 做业务归一化，再转成自定义 `TaskRequestDto`，最后由 bridge 再转成 `agents-cli /chat` 请求。
- `codex-main` 的基线是 thread/turn/item 原生协议，客户端直接 `thread/start` / `turn/start`，中间没有额外的业务桥接翻译层。

### 2. 语义路由前置在 hono-api

- 当前 `apps/hono-api/src/modules/task/public-chat-workflow.ts` 和 `task.agents-bridge.ts` 会基于 `mode`、`canvasNodeId`、`book/chapter`、`selectedReference`、`requireProjectTextEvidence` 直接推导执行模式、required skills、allowed subagent types、是否强制 team execution。
- 这让 `hono-api` 承担了本应由 agent 语义决策负责的逻辑。问题不在于业务工具留在后端，而在于后端替 agent 先做了语义决策。

### 3. system prompt 在 bridge 侧膨胀

- 当前 `task.agents-bridge.ts` 在 bridge 里拼接了大段 `planOnly`、`forceAssetGeneration`、chapter-grounded continuity、visual anchor、最终输出协议、项目状态表述禁令等规则。
- 这类内容很多属于 skill / agent policy / completion gate 范畴，不应长期停留在后端拼 prompt。

### 4. 流式协议被压平成 content/tool/result/done

- 当前 `agents-cli /chat` 只对外输出 SSE 事件：`content`、`tool`、`result`、`error`、`done`。
- `codex-main` 则保留 `thread.started`、`turn.started`、`item.started`、`item.updated`、`item.completed`、`turn.completed` 等更细粒度事件。

### 5. 完成态判断被 TapCanvas 业务合同强绑定

- 当前 `apps/agents-cli/src/core/completion/deterministic-completion-verifier.ts` 里已经嵌入大量 TapCanvas 领域约束：项目文本取证、chapter-grounded flow patch、image prompt spec、authority base frame、agents-team 证据。
- 这虽然比放在 `hono-api` 更合理，但仍需继续分层，避免 verifier 变成业务策略垃圾场。

## 对齐原则

- `hono-api` 保留业务工具执行、鉴权、计费、token 隔离、事实型上下文注入、失败透明化、trace 透传。
- 语义判断、是否读取哪些上下文、是否启用 team、如何拆任务、何时继续执行，默认交给 `agents-cli`。
- 技能与方法论进入 `skills/` 或 `apps/agents-cli` 内部 specialist 契约，不再在 `hono-api` 常驻 prompt 中堆规则。
- 对外流式协议尽量向 thread/turn/item 靠拢，至少不要只剩聚合 summary。
- agents 不一定直接写画布；可以返回结构化动作意图或调用业务远程工具，由业务层执行并审计。

## 改造清单

### A. 收缩 `/public/chat` 入口职责

- [ ] 将 `apps/hono-api/src/modules/apiKey/apiKey.routes.ts` 中的业务归一化逻辑收缩为：
  - 请求校验
  - 鉴权
  - 事实型上下文透传
  - stream/non-stream 协议桥接
  - 业务工具执行入口选择
- [ ] 禁止在这里继续新增 `workflowKey`、业务 route、场景分支、特殊 prompt guard。
- [ ] 将 `deriveChapterGroundedRequiredSkills` 一类推导逻辑从入口层移出，入口只保留事实字段，不做业务判决。

验收：

- `apiKey.routes.ts` 不再根据业务语义决定 team/skill/prompt 套餐。
- `public/chat` 入口传给 bridge 的字段以事实字段为主，不再混入大量语义结论。

### B. 下沉 `public-chat-workflow.ts` 的语义决策

- [ ] 重新审视 `apps/hono-api/src/modules/task/public-chat-workflow.ts`。
- [ ] 保留可复用的“结构化事实识别”函数，例如是否存在 `project/flow/book/chapter`、是否有 `selectedReference`。
- [ ] 删除或迁移以下能力到 `apps/agents-cli`：
  - chapter-grounded required skills 推导
  - allowed subagent types 推导
  - require agents team execution 推导
- [ ] 让 `agents-cli` 根据事实上下文自行决定是否加载 `agents-team` / `agents-team-novel-storyboard`。

验收：

- `public-chat-workflow.ts` 只描述事实 scope，不再返回业务执行决策。

### C. 瘦身 `task.agents-bridge.ts`

- [ ] 分拆 `apps/hono-api/src/modules/task/task.agents-bridge.ts`，按职责拆成独立模块：
  - request normalization
  - factual context assembly
  - remote tool contract assembly
  - stream protocol bridge
  - trace normalization
- [ ] 从 bridge 中移除或下沉以下内容：
  - `planOnlyGuardPrompt`
  - `forceAssetGenerationGuardPrompt`
  - `autoModeGuardPrompt` 中的业务方法论
  - `chapterGroundedStoryboardGuardPrompt`
  - `finalOutputProtocolPrompt` 中属于创作/判定方法论的部分
- [ ] bridge 只保留真正不可下沉的硬约束：
  - 鉴权与 scope 校验
  - 业务远程工具装配
  - 远程工具 endpoint / token 注入
  - 本地资源路径白名单
  - 结构化协议格式提示
  - 失败透明原则

验收：

- `task.agents-bridge.ts` 体积明显下降。
- 业务 SOP 不再主要写在 bridge prompt 中。

### D. 将 chapter-grounded 创作契约下沉到 agents-cli

- [ ] 把 chapter-grounded 连续性、基底帧 authority、`productionMetadata`、`imagePromptSpecV2` 约束，从 bridge prompt 继续下沉到 `apps/agents-cli`：
  - `skills/agents-team-novel-storyboard`
  - `apps/agents-cli/skills/tapcanvas-continuity`
  - completion verifier
  - specialist prompt
- [ ] `hono-api` 只透传事实：
  - 当前 `project/flow/book/chapter`
  - 参考图位
  - continuity 资产
  - 远程工具可用性
  - 业务读写能力边界
- [ ] 避免 `hono-api` 用自然语言长 prompt 指挥“先做什么后做什么”。

验收：

- 关闭 bridge 业务大 prompt 后，agents-cli 仍能完成同等 chapter-grounded 任务。

### E. 统一“技能加载”决策归属

- [ ] 当前 `requiredSkills` 由 bridge 强推，调整为：
  - 仅在极少数必须硬约束的场景透传
  - 默认让 `agents-cli` 自主调用 `Skill`
- [ ] 审核 `apps/agents-cli/src/core/agent-loop.ts` 的 required skills 预加载逻辑，保留机制，但减少 bridge 的强制使用频率。
- [ ] 把“什么时候必须 team mode”从 `hono-api` 前移，改为 `agents-cli` 基于 run context 自决。

验收：

- `requiredSkills` 成为例外，不是常态。
- `agents-cli` 能在事实充分时自行决定 team orchestration。

### F. 向 thread/turn/item 事件模型靠拢

- [ ] 为 `apps/agents-cli/src/server/http-server.ts` 设计 v2 流式协议，最少新增：
  - `turn.started`
  - `item.started`
  - `item.updated`
  - `item.completed`
  - `turn.completed`
- [ ] 保留现有 `content/tool/result/done` 仅作为兼容层，避免继续把它当唯一协议。
- [ ] 前端逐步改为消费 item 级事件，而不是只吃文本 delta 和 tool summary。
- [ ] 若某些业务操作仍由前端最终执行，也要让事件流能区分：
  - agent 决策出的动作意图
  - 业务后端已执行的动作
  - 前端本地已应用的动作

验收：

- 上游可以重建完整 turn 过程，而不只拿到最终汇总。
- 工具执行、agent message、失败项可以被前端独立渲染。

### G. 会话模型从 `sessionKey` 向真实 thread 模型对齐

- [ ] 评估 `public/chat` 是否需要引入真正的 thread 概念，而不是继续只用 `sessionKey` 复用 JSON history。
- [ ] 若短期不能重构为原生 thread，至少补齐：
  - turn id
  - per-turn item list
  - 可恢复的 turn trace
- [ ] 长期目标是让 public chat 与 project chat 共用更统一的 conversation model。

验收：

- 一次请求不再只是“拿字符串结果”，而是有清晰 turn 边界。
- 可以定位“哪一轮读了什么、哪一轮改了什么、哪一轮失败”。

### H. 收敛 `deterministic-completion-verifier.ts`

- [ ] 把 `apps/agents-cli/src/core/completion/deterministic-completion-verifier.ts` 分层：
  - 通用 completion gate
  - agents-team execution gate
  - TapCanvas project text evidence gate
  - chapter-grounded visual contract gate
- [ ] 将纯业务校验拆到独立文件，不要继续堆到一个 verifier 文件里。
- [ ] 复核哪些规则应该留在 deterministic gate，哪些更适合放到 tool contract 或 specialist skill。

验收：

- verifier 结构清晰。
- 新增业务规则不会继续污染通用 completion 框架。

### I. 让远程工具 contract 成为一等协议，而不是 prompt 暗示

- [ ] 审核 bridge 对 `remoteTools` / `remoteToolConfig` 的注入。
- [ ] 把 `tapcanvas_flow_patch`、storyboard continuity、video/image generation 的关键约束尽量沉到 schema 与 tool contract，而不是自然语言 prompt。
- [ ] 对需要强制的字段直接在 tool schema / server validation 层失败，不靠提示词提醒。
- [ ] 若某类操作最终不是由 `agents-cli` 直接执行，而是返回结构化数据给画布执行，也要把该动作协议视为一等 contract，而不是正文约定。

验收：

- 关键错误由结构化校验报出。
- prompt 中的“提醒性规则”显著减少。

### K. 明确“agent 产出动作意图”与“业务层实际执行”两阶段

- [ ] 为画布类能力区分两种模式：
  - 业务工具直执行业务写入
  - agent 只返回结构化动作数据，由画布或业务层应用
- [ ] 不论哪种模式，都统一产出结构化 action/result item，避免只剩自然语言说明。
- [ ] 禁止由 `hono-api` 在 agent 尚未做出决策前，先替它拼出固定节点方案。

验收：

- 节点创建、节点改写、布局调整、画布补丁可以明确区分“建议动作”和“已执行动作”。
- 前端可以决定是否自动应用、预览后应用或只展示草案。

### J. 文档与实现同步

- [ ] 重构过程中同步更新 `apps/hono-api/README.md` 的“AI 对话架构（当前）”章节。
- [ ] 新增一张对照图：
  - 当前 TapCanvas 链路
  - 目标对齐后的链路
- [ ] 明确列出哪些职责属于：
  - `apps/web`
  - `apps/hono-api`
  - `apps/agents-cli`
  - remote tools

验收：

- README 反映真实实现，而不是过时架构。

## 推荐实施顺序

1. 先做事件协议与 trace 对齐。
2. 再瘦身 `task.agents-bridge.ts`。
3. 再迁移 `public-chat-workflow.ts` 的决策逻辑。
4. 再下沉 chapter-grounded 方法论到 skills / agents-cli。
5. 最后重构 session/thread 模型。

## 首批应动文件

- `apps/hono-api/src/modules/apiKey/apiKey.routes.ts`
- `apps/hono-api/src/modules/task/public-chat-workflow.ts`
- `apps/hono-api/src/modules/task/task.agents-bridge.ts`
- `apps/hono-api/README.md`
- `apps/agents-cli/src/server/http-server.ts`
- `apps/agents-cli/src/core/agent-loop.ts`
- `apps/agents-cli/src/core/completion/deterministic-completion-verifier.ts`
- `apps/agents-cli/src/core/completion/agents-team-execution-gate.ts`
- `apps/agents-cli/skills/agents-team-novel-storyboard/SKILL.md`
- `apps/agents-cli/skills/tapcanvas-continuity/SKILL.md`

## 完成标准

- `hono-api` 不再承担主要语义路由与业务 SOP，但继续承担业务工具执行、token/权限/计费边界。
- `agents-cli` 可以基于事实上下文自主决定 skill、team、执行链。
- public chat 流式协议能表达 turn/item 过程。
- chapter-grounded 规则主要存在于 agents-cli 与 tool contract，不再依赖 bridge 长 prompt。
- 画布类能力可以明确区分“agent 决策结果”和“业务执行结果”。
- README 与真实代码保持一致。
