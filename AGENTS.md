

## 适用范围

- 本规范适用于本仓库的所有目录与文件。
- 若下级目录存在新的 `AGENTS.md`，下级规范仅可补充，不可弱化本文件的强约束。

## 项目目标与编码原则

- 项目定位为全新系统，`统一` 与 `简洁` 是最高优先级。
- 禁止以“兼容旧代码/旧行为”为理由引入冗余分支、兼容层、双轨逻辑或临时补丁。
- 新功能与重构应优先服务于一致性、可维护性、可读性，而非历史包袱。
- 禁止使用任何any类型，必须明确类型

## 文件与模块化要求

- 大文件必须拆分为清晰模块，按职责边界组织。
- 单个文件若同时承担多类职责（如 UI、状态、数据请求、转换逻辑混杂）必须拆分。
- 公共能力应抽离为可复用模块，避免复制粘贴。
- 命名必须体现职责，目录结构应支持快速定位与阅读。

## 数据安全与高风险操作

- 任何可能导致数据 `删除`、`丢失`、`覆盖`、`结构变更`、`不可逆修改` 的操作，执行前必须获得用户明确同意。
- 未获得明确同意时，仅允许进行只读分析、方案设计与风险说明，不得落地执行。
- 涉及数据库、文件批量改写、迁移脚本、清理脚本、覆盖写入等场景，一律按高风险处理。
- 但可以运行测试、构建等无害的操作。
- 可以执行测试，构建等没有毁灭性的命令

## 思维与决策方法

- 所有方案必须采用第一性原理：先明确目标、约束与事实，再推导实现路径。
- 禁止基于“惯例如此”或“历史如此”直接做决策；必须说明核心假设与取舍依据。
- 实现应追求最小必要复杂度，避免无效抽象与过度设计。
- 面向用户展示的状态文案、进度提示、等待提示与系统反馈必须基于已确认事实，禁止伪造进度、臆测阶段、夸大完成度或用安抚性措辞掩盖真实状态。

## 命令与 Git 操作限制

- 允许执行任意开发/测试/运行相关命令（例如：`pnpm`、`docker-compose`、`curl`、`node`、`rg` 等），用于完成用户目标。
- Git 相关操作：
  - 允许 Git 只读查询：`git status`、`git log`、`git diff`、`git show`、`git branch`（只读用法）。
  - 任何会改变 Git 状态或历史的操作（例如：`commit`、`push`、`pull`、`merge`、`rebase`、`cherry-pick`、`reset`、`checkout`（修改性用法）、创建/删除分支、打标签）仍必须先获得用户明确同意。
- 破坏性命令（例如 `rm -rf`、删除/清空数据库、不可逆覆盖写入、结构性迁移）仍按“高风险操作”处理：执行前必须再次明确确认目标与影响范围。

## 不掩盖任何问题

- 不要做任何不必要的回退逻辑，特别是有可能隐藏问题的，除非用户允许，否则禁止做，如发现一个模型不可用时自动跳转到新的模型，或代码失效时，报错时直接略过，或者没有的时候提供默认值等错误操作，或制造假数据等。
  -系统执行必须遵循显式失败与零隐式回退原则：严禁静默跳过错误、隐式配置兜底或自动模型降级，确保所有非预期行为原地崩溃并如实上报。

## 敢于合理质疑用户 了解用户真实需求

- 提问以了解我真正需要什么（不仅仅是我说什么）。
- 用户可能不够了解代码 对技术的理解可能不如你
- 用户和你说的作为参考 而不是绝对值 如果某些事情说不通，请挑战我的假设。

# AI Assistant Skills / 能力说明

- Model: GPT-5.1 running in Codex CLI，专注于代码编辑和重构。
- Can:
  - 阅读、理解并修改本仓库内的所有 TypeScript/React/Mantine/React Flow 代码。
  - 调用 shell 命令（如 `pnpm`、`rg`、`git log`）在工作区内查找问题、跑构建/测试。
  - 在 monorepo 结构中跨 `apps/`、`packages/`、`infra/` 进行联动修改（保持变更聚焦、最小化）。
  - 设计和实现新组件、新 hooks、新 Zustand store 以及 AI canvas 相关逻辑（前后端工具契约保持同步）。
  - 帮助梳理/重写提示词（SYSTEM_PROMPT）、tool schemas、node specs，并给出多步方案和重构建议。
  - 使用在线搜索获取最新库/框架用法（如 Mantine、React Flow、Vite、Cloudflare Workers 等）。
- Won't:
  - 不会主动创建 Git 分支或提交 `git commit`（除非你明确要求）。
  - 不会修改与当前任务无关的大范围代码或重构整个架构。
  - 不会引入与现有技术栈冲突的新框架或大型依赖，除非经过确认。
- How to use me:
  - 直接描述你要完成的任务（可以是中文或英文），包括目标页面/模块、交互和约束。
  - 如果希望我跑构建或测试，可以明确说“帮我跑一下构建/测试并修到通过为止”。
  - 复杂任务我会先给出分步 plan，并在实现过程中更新进度。
  - 我同时会按需调用 Codex 本地 skills（`~/.codex/skills`）作为“专家模式”，当前可用的包括：`web`、`api`、`devops`、`test`、`debugger`、`security`、`perf`、`docs`、`review`、`git`、`ux`、`a11y`、`analytics`、`copy`、`pricing`、`custdev`、`coach`、`obsidian`、`orchestrator`、`research`、`ios` 等。
- Review & Orchestration:
  - Use a hard cutover approach and never implement backward compatibility.
  - 在每次认为“任务已完成”之前，必须先执行一次显式 review：对照用户最初的需求、当前的计划（plan）和已做的改动/输出，确认是否覆盖所有预期；如有缺口则继续迭代而不是立即结束回复。
  - 默认以 orchestrator 模式运行复杂任务：维护和更新 To-Do plan（使用 Codex 的计划工具），拆分子任务并在每个阶段后做小结，直到明确满足用户目标才停止。
  - 在合适的场景下，可以通过命令来辅助确认完成状态，例如：`codex exec "count the total number of lines of code in this project"`、`pnpm --filter @tapcanvas/web build` 或简单的 `rg`/`ls` 检查；这些命令用于验证和 sanity check，而不是替代逻辑上的需求对齐。
  - 如果 review 发现任何一项用户预期尚未满足（功能缺失、覆盖不全、验证未做、实现偏离需求等），必须：1）更新计划（plan），2）继续执行新的子任务直至问题解决；在这些检查通过之前，不得将当前用户请求视为“完成”并结束回复。
  - 文档同步约束（强制）：凡是修改 AI 对话链路、agents bridge、`/public/chat` 路由、prompt 装配、persona/context 加载、workspace context 装配、outputMode 分支、tool gating、trace/diagnostics 行为，必须同步更新 `apps/hono-api/README.md` 中的“AI 对话架构（当前）”章节，确保该文档始终反映当前真实实现；未同步文档视为任务未完成。
  - 代码与设计强制原则：遵循 DDD 分层/契约一致性、雅虎军规式前端性能优化、单一职责拆分，以及能用纯函数就不用有副作用的实现；新增能力时保持前后端 schema/模型同步。
  - 失败策略（强制）：失败就是失败。禁止为“看起来可用”而做静默兜底/自动降级/模板填充（尤其是小说分镜、镜头提示词、剧情抽取、角色一致性链路）。当关键输入缺失或解析失败时，必须显式报错并暴露原因，由用户或上游流程修复后重试。
  - 生成后处理规则（强制）：视频/图片任务一旦已成功产出资产，禁止在后处理阶段做任何拦截、质检门禁、自动回滚或丢弃；必须保留并记录全部已产出资产（节点结果、日志与元数据），后续仅允许新增记录，不允许覆盖删除已生成结果。
  - 诊断策略（强制）：拿不定就不要猜测，必须先记录可检索日志（输入摘要、关键分支、工具调用结果、解析失败原因），再返回错误；禁止仅返回笼统失败描述。
  - 定位策略（强制）：禁止在证据不足时主观猜测根因；一旦拿不准，必须先补充可观测性（新增/加强日志、trace、关键入参与返回值）并基于日志定位，再给出结论与修复方案。
  - 生产范式（强制）：核心流程默认由 AI（agents-cli）端到端完成，人工只做微调。涉及小说分镜/镜头续写/剧情补全/生产编排时，优先通过 agents-cli 根据当前进度自动产出结果，再进入人工校正；避免把主要生成逻辑下放为手工拼装。
  - Agents 优先级（强制）：语义理解、功能决策、流程拦截与修复建议，默认以 agents-cli 输出为最高优先级；能由 agents-cli 完成的能力，不应退化为本地写死正则/关键字规则来替代。本地规则仅可用于结构性校验（如空值、类型、数量、权限、边界），不得覆盖或否定 agents-cli 的语义结论。
  - 语义识别禁令（强制）：禁止在业务流程中使用正则/关键字硬编码进行语义理解、语义识别或语义拦截（包括分镜质量判断与内容风险判断）；相关决策必须以 agents-cli 的语义输出为准。本地仅允许做非语义的结构性校验（空值、类型、数量、权限、边界）。
  - 语义实现禁令（强制）：所有涉及语义理解的逻辑（意图识别、语义分类、语义路由、语义拦截、语义纠错、语义数量理解等）一律禁止使用正则实现；必须由 agents-cli/agents 的语义输出驱动。
  - AI 对话反僵化约束（强制）：禁止把 AI 对话实现为“用户意图 -> 本地固定 route -> 本地固定 system prompt 分支 -> 本地固定执行流程”的中心化硬编码链路；必须优先设计成“真实上下文收集 -> 执行建议 -> agents 自主决策 -> 前端/后端执行”的编排结构。
  - 运行时知识源约束（强制）：AI 运行时可注入的知识源仅限 `skills/`、当前真实代码、当前项目状态、工具返回结果与用户本轮提供的显式上下文；任何运行时知识装配都必须优先基于这些一手事实。
  - 静态资产运行时禁令（强制）：`docs/`、`assets/`、`ai-metadata/` 属于编译前资产、分析资产或人工阅读资产，默认不得作为 agents、agents-cli、`/public/chat`、system prompt、prompt specialist、知识 allowlist 或上下文拼装的运行时输入来源；若未来确需引入，必须先获得用户明确批准并同步更新本文件与 `apps/hono-api/README.md`。
  - 编排职责边界（强制）：前端/本地代码只负责 1）收集真实上下文 2）注入安全硬约束 3）执行本地可验证动作 4）展示过程与结果；涉及“是否读取项目上下文、是否返回画布计划、是否直接生成、下一步调用哪类工具”等带有语义判断的决策，必须交给 agents / agents-cli / LLM，不得由本地关键词或枚举分支替代。
  - `hono-api` 职责边界（强制）：`apps/hono-api` 只允许承担硬约束注入与协议编排职责，包括权限、协议格式、输出契约、事实性约束、失败策略、trace/diagnostics；禁止在 `hono-api` 中固化 SOP、创作方法论、知识装配顺序、意图路由、固定 prompt 套餐、固定子代理顺序或 prompt specialist 编排策略。
  - `agents-cli` 职责边界（强制）：意图识别、证据规划、技能选择、子代理委派、任务拆解与最终综合判断，必须默认由 `agents-cli` / agents 承担；前端与 `hono-api` 不得以本地 route、枚举分支、关键词表或 prompt 分流替代 agents 的语义决策。
  - `agents-cli` 最终自检（强制）：禁止依赖 `hono-api` / 前端通过手写 prompt 补丁、语义关键词检查或本地兜底规则去拦截“输出不符合用户预期”的问题；`agents-cli` 必须在最终输出前执行一次面向用户意图的自检，核对“实际产物类型、执行动作、结果落点、是否真的完成用户要的事”是否一致。若自检发现偏差（例如用户要图片却只产出文本节点、用户要落画布却只给说明文案），必须在 `agents-cli` 内部继续修正或显式失败，不能把问题下沉给 `hono-api` / 前端做 prompt 打补丁式修复。
  - `agents-cli` 运行时自修复原则（强制）：planning gate、completion gate、delivery verifier 等通用收口器一旦判定“尚不能结束”，必须优先把失败事实（如 `failureReason`、`rationale`、`missingCriteria`、`requiredActions` 与相关 planning/delivery 状态）在同一条 `agents-cli` 执行链内回灌给主代理继续修正，直到满足完成态或显式失败；这类内部纠偏信息必须以 ephemeral 运行时消息存在，不得写回持久会话。禁止把这类修复长期下沉为 `hono-api` / `apps/web` 的 case-specific prompt 补丁、正则拦截、关键词兜底或固定 route 修复。
  - 交付验收契约（强制）：凡是 agents bridge / `/public/chat` / `turnVerdict` / diagnostics / completion gate / 结果验收相关实现，必须采用“`expectedDelivery -> deliveryEvidence -> deliveryVerification`”这类通用交付校验链路。先根据 agents 的结构化语义摘要与真实作用域确定“期望交付类型”，再基于真实 trace / tool calls / 节点最终状态 / 资产 URL 构造“事实证据”，最后由可复用 verifier 判断是否满足交付。禁止把“有文本”“写了画布”“子代理 completed”“wait 返回了”直接当作完成态充分条件。
  - 交付验收禁令（强制）：禁止为某个具体 case 临时添加硬编码完成态/失败态补丁，例如针对单个工作流、单类 prompt、某一章小说、某一种节点组合去写专用 `if` / 正则 / 关键词 / `includes` / 计数规则来决定 satisfied/failed。若发现当前 verifier 覆盖不了新场景，必须回到通用交付契约层扩展 `expectedDelivery`、`deliveryEvidence` 或 verifier 维度，而不是继续堆叠 case patch。
  - 前端执行层禁令（强制）：`apps/web` 在执行或校验 AI 返回的 canvas plan、节点 prompt、storyBeatPlan、对白字段时，只允许做 schema、类型、数量、时长、句柄、资产 URL、章节追溯等结构性校验；禁止基于 prompt 正文、对白文本或上游文案做正则/关键词/`includes` 匹配，也禁止本地自动改写 prompt 来“补对白”“去报告腔”或兜底生成语义。
  - Prompt Specialist 归属（强制）：`image_prompt_specialist`、`video_prompt_specialist`、`pacing_reviewer` 的创作方法论、视觉模型提示词写法、镜头语言规范、`@角色名` 角色卡绑定语义，必须沉到 `apps/agents-cli` 内部 prompt / skill / specialist 契约中；禁止长期依赖 `apps/hono-api` 通过常驻 system prompt 为这些 specialist 补产品语义。
  - 视觉提示词语义归属（强制）：凡是“给图片/视频模型直接执行的生成提示词”相关规则，例如主体/场景/空间布局/人物关系/镜头语言/动作边界/禁止漂移，以及 `@角色名` 应保留为角色卡绑定语法，都属于 agents-cli specialist 的原生能力；`hono-api` 只可传递事实型上下文，不应承载这类方法论。
  - Skills 职责边界（强制）：SOP、方法论、分阶段策略、创作套路、连续性规则、prompt specialist 使用方式等“可渐进披露的专业知识”，必须沉淀在 `skills/` 中按需加载；禁止把这些内容重新膨胀为常驻 system prompt、固定后端模板或前端硬编码说明链路。
  - 本地规则白名单（强制）：本地仅允许处理纯结构性或确定性动作，如空值、类型、数量、权限、边界校验，以及用户显式指定且无需语义推断的本地操作（如“只重排当前画布布局”）。除上述白名单外，禁止本地代码接管语义决策。
  - 前置资产执行门禁（强制）：凡是图片/视频/分镜板生成依赖上游视觉资产的场景，执行时必须要求前置节点已经存在真实资产 URL（如 `imageUrl`、`imageResults[].url`、`videoUrl`、`videoResults[].url`、`storyboardEditorCells[].imageUrl`、`firstFrameUrl`、`lastFrameUrl`）。仅有节点连线、文本脚本、prompt、planned metadata、占位状态，不构成可执行前置资产。画布内点击某节点“生成”时，运行时必须先自动补跑该节点之前、直到该节点为止的未生成资产链路；若补跑后仍缺真实 URL，才允许停在待执行/显式失败状态，禁止把缺前置资产的下游节点当作可直接执行。
  - 硬编码扩散禁令（强制）：禁止通过新增或维护关键词表、别名表、同义词表、`includes` 链、正则链、超长 `switch(route)`、多套 prompt 模板分流来“提升命中率”。这类实现一律视为灵活性退化，不得作为正式方案提交。
  - 默认失败原则（强制）：当是否执行、如何执行依赖语义判断而 agents 输出不足时，必须显式暴露“语义决策证据不足”，不得使用本地默认 route、默认模式、默认 prompt、默认工作流进行兜底。
  - 单一路径原则（强制）：同一类 AI 对话能力不得同时维护“agent 决策链”和“本地硬编码决策链”双轨实现；若发现历史双轨逻辑，重构时必须做硬切换，禁止继续保留兼容分支。
  - Prompt 分流禁令（强制）：禁止按本地 route 枚举为每一类意图拼装彼此割裂的固定 prompt 套餐；system prompt 应以统一助手身份、真实上下文、能力约束和本轮执行建议为核心，保留 agents 的自主工具选择与任务规划空间。
  - 模型继承原则（强制）：主代理与其创建的子代理默认视为同一条执行链；子代理必须继承父代理本轮实际生效的模型配置，不得隐式回落到默认模型、备用模型或其他未显式指定模型。若模型继承失败，必须显式报错并记录日志，禁止静默继续。
  - 评审红线（强制）：任何涉及 AI 对话、意图识别、agent 编排的改动，只要出现以下任一信号，默认判定为设计回退，除非用户明确批准，否则不得合并：
    1. 使用正则、关键词表、`includes` 链做语义理解或意图路由
    2. 用本地 `switch(route)` / `if route === ...` 主导主要任务决策
    3. 用默认 route / fallback route / fallback prompt 吞掉语义不确定性
    4. 以“兼容旧行为”为理由保留本地硬编码决策双轨
    5. 新增一个平行的本地 AI 流程而不是复用 agents bridge、记忆、项目上下文和画布协议
    6. 将 `docs/`、`assets/`、`ai-metadata/` 重新接入运行时 prompt、知识加载、specialist allowlist 或 agent 上下文装配
    7. 在 `apps/web` 或 `apps/hono-api` 中重新引入本地固定工作流、固定意图分流或固定子代理编排来覆盖 agents-cli 的自主决策
    8. 在 `turnVerdict`、diagnostic flags、completion gate 或结果验收链路中新增 case-specific 硬编码补丁，而不是扩展通用 delivery verifier
    9. 通过正则、关键词、prompt 文案匹配、个案节点数量阈值等局部启发式去直接判定“这轮已完成/失败”，而不是先构造可复用的事实证据与交付校验契约
  - 分镜连续性（强制）：章节分镜每个分组的生成结果，除数据库外，必须写入项目本地元数据（book `index.json` 的 `assets.storyboardChunks`）。后续分组生成时，agents-cli 必须先读取上一组 `tailFrameUrl`，并将其作为下一组首帧参考图；缺失则直接失败，不允许兜底。
  - Skill 约束（强制）：执行章节分镜续写时，优先使用仓库内 skill：`skills/storyboard-continuity/SKILL.md`，按其中契约读写 `storyboardChunks`，确保“尾帧承接”可追溯、可复现。
  - 交互规则（强制）：用户触发“当前章节分镜/章节分镜生产”后，前端必须先在画布创建对应占位节点（queued/running），再异步执行 agents pipeline，并在完成/失败后回填该节点状态与内容；禁止等待 pipeline 完成后才创建节点。
- 续写来源规则（强制）：章节分镜续写时，不得回退使用历史“已生成镜头记录”作为脚本来源；必须在生成前仅将“上一个分镜剧本片段”传给 agents-cli（首组无上文），以本次 agents 输出作为唯一有效脚本来源。生成成功后再将结果写回元数据（含 storyboardPlans/storyboardChunks）。
- 画布验证与操作路径（强制）：凡是为了读取、验证、修改、轮询用户真实画布数据而访问 TapCanvas 对外接口时，只允许通过 `apps/agents-cli/skills/tapcanvas-api` 这一条 skill 路径执行，禁止绕过该 skill 直接拼接请求、调用平行 skill、或使用其他临时脚本触碰用户画布数据。
- 画布验证能力扩充（强制）：若 `tapcanvas-api` 在验证或操作用户画布数据时缺少必要能力，必须先以当前仓库源码中的真实公开接口、请求方法、参数契约为依据扩充该 skill，再继续验证；禁止脱离 skill 直接走其他路径完成同类操作。

# Repository Guidelines

## Project Structure & Modules

- Monorepo: `apps/`, `packages/`, `infra/`.
- Web app: `apps/web` (Vite + React + TypeScript, Mantine UI, React Flow canvas).
  - Canvas and UI: `apps/web/src/canvas`, `apps/web/src/ui`, `apps/web/src/flows`, `apps/web/src/assets`.
- Backend API: `apps/hono-api` (Cloudflare Workers + Hono).
- Shared libs: `packages/schemas`, `packages/sdk`, `packages/pieces`.
- Local orchestration (optional): `infra/` (Docker Compose setup).

## Build, Test, and Dev

- Install deps (workspace): `pnpm -w install`
- Dev web: `pnpm dev:web` (or `pnpm --filter @tapcanvas/web dev`)
- Dev api: `pnpm --filter ./apps/hono-api dev` (Wrangler dev)
- Build all: `pnpm build`
- Preview web: `pnpm --filter @tapcanvas/web preview`
- Compose up/down (optional): `pnpm compose:up` / `pnpm compose:down`
- Tests: currently minimal; placeholder in `apps/web`.

## Coding Style & Naming

- Language: TypeScript (strict), React function components.
- UI: Mantine (dark theme), React Flow for canvas; Zustand for local stores.
- UI aesthetic: keep components borderless for a clean, frameless look.
- Filenames: React components PascalCase (`TaskNode.tsx`), utilities kebab/camel case (`mock-runner.ts`, `useCanvasStore.ts`).
- Types/interfaces PascalCase; variables/functions camelCase.
- 禁止新增 `any` 类型定义或 `as any` 断言；必须使用精确类型、`unknown` + 类型收窄或类型守卫。
- Readability & maintainability first: prefer small, focused modules and consistent naming; avoid hidden side effects.
- Prefer curried functions where it improves reuse/composability, and favor pure functions over side-effectful logic.
- JSX/TSX: every tag must include a descriptive, named `className` for easier targeting and debugging.
- Keep modules focused; colocate component styles in `apps/web/src`.
- 前端视觉规则（强制）：
  - 极简主义为默认视觉原则：任何边框、描边、装饰线、额外容器都必须有明确的信息表达职责；纯装饰性边框默认禁止。
  - 单层圆角边框原则（强制）：一个独立 block / card / panel / modal section / node section 中，最多只允许一层容器同时拥有“圆角 + 可见边框”。若外层已有圆角边框，内层必须改为无边框、无圆角，或仅保留直角弱分隔。
  - 禁止出现“圆角套圆角”层层包裹；外层容器已圆角时，内层卡片/按钮/预览格默认改为直角或近似直角，优先靠分隔、留白、颜色层级表达结构。
  - 边框会转移注意力，默认不是主要层级工具；组件层级优先通过留白、对齐、背景明度差、文字层级表达。
  - 内容密度尽可能高；同屏优先展示有效信息，减少大块说明文案、低信息装饰和过高行高。
  - 能用 icon 表达的操作，默认不要再放冗余文字按钮；优先使用 icon / icon+tooltip / aria-label。
  - 根目录 `Design.md` 是当前仓库的全局设计真源；凡是新增或重构页面、样式、组件、交互，必须先对齐该文档中的视觉主题、颜色、字体、组件语言与禁用项，违反视为任务未完成。
  - `apps/web/DESIGN.md` 只承担 Web 侧执行映射与落地检查职责；若与根目录 `Design.md` 冲突，必须以根目录 `Design.md` 为准。

## Modularity & Performance

- 一个文件不应过大；当组件/服务超过单一职责时拆分为更小的子组件、hooks、utils，保持渲染与副作用/数据逻辑解耦。
- 函数化与抽象优先：重复逻辑提炼为纯函数或共享工具；跨页面/画布的通用行为放入 packages 层以复用。
- 遵循“雅虎军规”式前端性能准则：减少请求次数（合并资源/雪碧图/内联关键 CSS）、使用 CDN 与长缓存、开启 gzip/br（或 vite 静态压缩）、压缩/去重/按需加载 JS/CSS、避免阻塞渲染的同步脚本、减少 DNS 解析与重定向。
- 交付优化：懒加载重型路由/模型、尽量使用异步加载与 prefetch/prerender、避免重复拉取同一资源，保持资源路径和依赖有清晰的 owner。
- 画布拖动热路径强制约束：
  - `onNodesChange`、`onNodeDrag`、`onSelectionDrag`、`onMove` 等高频链路中，禁止引入全量 `nodes/edges` 扫描、全量 `map/filter` 派生、全量序列化、全量 deep clone、自动保存、网络请求、日志批量整理或任何 O(N)/O(E) 且每帧重复执行的同步工作。
  - 拖动/缩放期间，禁止做“每次 position change 都全量校验所有 edges”这类实现；只有会真实影响边合法性的结构性变更（如节点/handle 增删、连接关系变化）才允许触发边校验。
  - App 级订阅或顶层容器订阅禁止因节点位置变化而重建与位置无关的派生数据；像 `nodeLabelById`、统计摘要、面板映射这类数据，必须只在对应字段真实变化时更新。
  - 画布浮层、工具条、选择条、诊断面板若依赖 viewport 或 selection 之外的大对象，必须避免在拖动期间参与高频重算；必要时在 drag lifecycle 内隐藏、冻结或拆到更细粒度订阅。
  - 若出现“拖动一段时间假死、随后恢复、再周期性卡顿”，优先排查定时器轮询、全局订阅、拖动热路径上的全量派生与结构校验，禁止先加兜底或降级掩盖问题。

## Testing Guidelines

- Preferred: Vitest for new tests (TBD in repo).
- Test files: `*.test.ts` / `*.test.tsx`, colocated near source.
- Run (when added): `pnpm test` or `pnpm --filter @tapcanvas/web test`.

## Commit & PR

- Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`; scope when relevant, e.g., `feat(web): multi-select group overlay`.
- PRs include: summary, screenshots/GIFs for UI, steps to run (`pnpm -w install && pnpm dev:web`), and any migration notes.

## Canvas Dev Tips

- Use `ReactFlowProvider` at the app level; hooks like `useReactFlow` require the provider.
- Canvas fills the viewport; header is transparent with only TapCanvas (left) and GitHub icon (right).

## AI Tools & Models

- Image nodes default to `nano-banana-pro` and are designed for text-to-image, storyboard stills from long-form plots, and image-to-image refinement.
- Prefer `nano-banana-pro` when building flows that need consistent visual style across scenes; other image models are optional fallbacks.
- When wiring tools, treat image nodes as the primary source of “base frames” for Sora/Veo video nodes, especially for novel-to-animation workflows.
- 强制：所有前端/对话中的“模型可选列表”必须来自系统模型管理（model catalog / vendor 配置）的动态数据；禁止写死模型枚举作为可选来源（仅允许在动态列表为空时做占位提示，不允许回退到硬编码候选）。
- 强制：`agents-cli` / `agents` 均指同一个可调用的自研智能体进程能力（Agents Bridge），不是第三方渠道商（vendor）。涉及该能力的路由与校验应按“能力通道”处理，不得要求其在模型管理中作为厂商条目存在后才可调用。

## AI Tool Schemas (backend)

- Shared tool contracts live in `apps/hono-api/src/modules/ai/tool-schemas.ts`. This file describes what the canvas can actually do (tool names, parameters, and descriptions) from a **frontend capability** perspective, but is only imported on the backend to build LLM tools.
- Whenever you change or add frontend AI canvas functionality (e.g. new `CanvasService` handlers, new tool names, new node kinds that tools can operate on), you **must** update `apps/hono-api/src/modules/ai/tool-schemas.ts` in the same change so that backend LLM tool schemas stay in sync.
- Whenever you change canvas node protocols, handle matrices, `tapcanvas_flow_patch` / canvas plan schema, or node-kind semantics such as `storyboard` vs `storyboardScript`, you **must** also update the TapCanvas agent skill documentation that agents-cli actually loads. Current source of truth skill file: `/Users/libiqiang/.agents/skills/tapcanvas/SKILL.md`. If skill docs are not updated in the same change, the task is not complete.
- The TapCanvas skill doc must also stay aligned with execution preconditions, including “no upstream real asset URL, no downstream generation”. If runtime behavior or allowed prerequisite asset fields change, update `/Users/libiqiang/.agents/skills/tapcanvas/SKILL.md` in the same change.
- Do not declare tools or node types in `canvasToolSchemas` that are not implemented on the frontend. The schemas are not aspirational docs; they must reflect real, callable capabilities.
- Node type + model feature descriptions live in `canvasNodeSpecs` inside the same file. This object documents what each logical node kind (image/composeVideo/audio/subtitle/character etc.) is for, and which models are recommended / supported for it（例如 Nano Banana / Nano Banana Pro / Sora2 / Veo 3.1 的适用场景与提示词策略）。Model-level prompt tips（如 Banana 的融合/角色锁、Sora2 的镜头/物理/时序指令）也应集中维护在这里或 `apps/hono-api/src/modules/ai/constants.ts` 的 SYSTEM_PROMPT 中，避免分散。
- When you add or change node kinds, or enable new models for an existing kind, update `canvasNodeSpecs` 与相关系统提示（SYSTEM_PROMPT）以匹配真实接入的模型能力（不要列出实际上未接入的模型或特性）。

## Multi-user Data Isolation

- All server-side entities (projects, flows, executions, model providers/tokens, assets) must be scoped by the authenticated user.
- Never share or read another user's data: every query must filter by `userId`/`ownerId` derived from the JWT (e.g. `req.user.sub`).
- When adding new models or APIs, always design relations so they attach to `User` and are permission-checked on every read/write.

---

# `apps/agents-cl（Agents CLI）功能说明

本仓库内包含一个独立的 TypeScript 命令行智能体项目：`apps/agents-cl。它提供一个最小但可扩展的 agent loop：`plan -> tool -> report`，支持 Skills（按需加载的知识/模板）、Todo（任务清单）、Subagent（子代理隔离上下文）、会话续写（JSONL history）、以及可选的 agents-world 日志推送。

> 这部分文档只描述仓库内 `apps/agents-cl 的真实实现（以代码为准），不是“理想设计”。

## 索引

- [入口与目录结构](#agents-cli-structure)
- [命令与运行模式](#agents-cli-commands)
- [配置与环境变量](#agents-cli-config)
- [Profile（general / code）](#agents-cli-profile)
- [Tools（工具）清单与参数](#agents-cli-tools)
- [Skills（技能）系统](#agents-cli-skills)
- [Task（子代理）与 agent types](#agents-cli-task)
- [记忆（Session / Long-term）](#agents-cli-memory)
- [agents-world 日志](#agents-cli-world)
- [安全边界与已知限制](#agents-cli-security)

<a id="agents-cli-structure"></a>
## 入口与目录结构

- CLI 入口：`apps/agents-cli/src/cli/index.ts`（构建后为 `apps/agents-cli/dist/cli/index.js`）
- Agent 主循环：`apps/agents-cli/src/core/agent-loop.ts`（负责 messages、tools、toolCalls 的多轮循环）
- LLM 适配层：`apps/agents-cli/src/llm/client.ts`（兼容 `/responses` 与 `/chat/completions`，支持 SSE）
- 配置加载：`apps/agents-cli/src/core/config.ts`（local/global/.env/env 覆盖、写入全局缓存）
- Tools 实现：`apps/agents-cli/src/core/tools/*`
- Skills 加载：`apps/agents-cli/src/core/skills/loader.ts`
- 子代理类型：`apps/agents-cli/src/core/subagent/types.ts`
- 会话历史：`apps/agents-cli/src/core/memory/session.ts`
- world logger：`apps/agents-cli/src/core/logs/world-logger.ts`

<a id="agents-cli-commands"></a>
## 命令与运行模式

命令定义在 `apps/agents-cli/src/cli/index.ts`，核心命令：

- `agents init`：在当前目录生成 `agents.config.json`（若不存在）、创建 `skills/`、创建 `.agents/memory/`
- `agents run "你的任务"`：非交互单次运行（也支持 stdin 输入）
  - `--no-stream`：关闭流式
  - `--session <id>`：指定会话 ID（跨多次 run 续写）
- `agents repl`：交互式 REPL（进程内 history，不落盘）
- `agents skill new <name>`：创建 `skills/<name>/SKILL.md` 模板
- `agents global-init`：将当前配置写入 `~/.agents/agents.config.json`

在本仓库（pnpm workspace）里常见两类使用方式：

- **把 `apps/agents-cl 当作 CLI 工具用**（工作区 = 你当前所在目录 `cwd`）：
  - 先构建一次：`pnpm --filter agents build`
  - 在“目标工作区目录”下运行：`node <repo>/apps/agents-cli/dist/cli/index.js run "..."`
  - 说明：工具的读写与 shell 都以“当前 `cwd`”为边界（路径沙箱也以此为准），所以想让它操作仓库根目录，就在仓库根目录执行上述命令
- **开发/调试 `apps/agents-cl 本身**（工作区通常 = `apps/agents-cl）：
  - `pnpm --filter agents dev -- run "..."`
  - `pnpm --filter agents dev:watch -- run "..."`

<a id="agents-cli-config"></a>
## 配置与环境变量

### 配置文件优先级

配置通过 `apps/agents-cli/src/core/config.ts` 合并：

1. 默认值（DEFAULT_CONFIG）
2. 全局配置：`~/.agents/agents.config.json`
3. 当前目录配置：`./agents.config.json`
4. 环境变量覆盖（见下）

最终会把 `workspaceRoot` 设置为当前 `cwd`。

### 常用环境变量

- `AGENTS_API_KEY`：API Key（必填；也兼容 `RIGHT_CODES_API_KEY`）
- `AGENTS_API_BASE_URL`：API base（默认 `https://right.codes/codex/v1`；可改为 `https://api.openai.com/v1`）
- `AGENTS_MODEL`：模型名（默认 `gpt-5.2`）
- `AGENTS_API_STYLE`：`responses` 或 `chat`
- `AGENTS_STREAM=true|false`：是否流式（CLI 也可用 `--no-stream`）
- `AGENTS_REQUEST_TIMEOUT_MS`：请求超时（`apps/agents-cli/src/llm/client.ts`）
- `AGENTS_WORLD_API_URL`：agents-world 后端地址（启用日志推送）
- `AGENTS_PROFILE=general`：通用/非 code 模式（见下一节）

<a id="agents-cli-profile"></a>
## Profile（general / code）

`AGENTS_PROFILE=general`（或 `nocode` / `chat`）会进入“通用模式”：

- 禁用会修改本地环境的工具：不注册 `bash` / `read_file` / `write_file` / `edit_file` / `Task`
- 通过 `systemOverride` 强制约束：中文回答、不得执行 shell、不得读写文件、不得 git 操作
- 仍保留 `TodoWrite` 与 `Skill`（可用于对话式规划与加载知识）

默认 profile 为 `code`：

- 注册 `bash` / `read_file` / `write_file` / `edit_file` / `TodoWrite` / `Skill` / `Task`
- 可在仓库内执行探索与改动（仍受工具层的“路径沙箱/危险命令”限制）

<a id="agents-cli-tools"></a>
## Tools（工具）清单与参数

工具通过 OpenAI function calling 形式暴露（见 `apps/agents-cli/src/core/tools/*`）。当前实际注册的工具如下（以 `code` profile 为准）：

- `bash`（`apps/agents-cli/src/core/tools/shell.ts`）
  - 参数：`{ "command": string }`
  - 说明：在 `cwd` 执行命令，输出合并 stdout/stderr，截断到 50k 字符；包含简单危险命令拦截（如 `sudo`、`shutdown`、`rm -rf /`）
- `read_file`（`apps/agents-cli/src/core/tools/fs.ts`）
  - 参数：`{ "path": string, "limit"?: number }`
  - 说明：读取文件（按行截断），输出截断到 50k 字符；路径必须在 `cwd` 内（防越界）
- `write_file`（`apps/agents-cli/src/core/tools/fs.ts`）
  - 参数：`{ "path": string, "content": string }`
  - 说明：覆盖写入（自动 mkdir），路径必须在 `cwd` 内
- `edit_file`（`apps/agents-cli/src/core/tools/fs.ts`）
  - 参数：`{ "path": string, "old_text": string, "new_text": string }`
  - 说明：仅替换首次匹配（不支持 patch/hunk 语义），路径必须在 `cwd` 内
- `TodoWrite`（`apps/agents-cli/src/core/tools/todo.ts`）
  - 参数：`{ "items": Array<{ "content": string, "status": "pending"|"in_progress"|"completed", "activeForm": string }> }`
  - 约束：最多 20 条；`in_progress` 同时只能有 1 条（见 `apps/agents-cli/src/core/planner/todo.ts`）
- `Skill`（`apps/agents-cli/src/core/tools/skill.ts`）
  - 参数：`{ "skill": string }`
  - 说明：按需加载 `skills/<name>/SKILL.md`，并把内容包裹在 `<skill-loaded>` 块中返回给模型
- `Task`（`apps/agents-cli/src/core/tools/subagent.ts`）
  - 参数：`{ "description": string, "prompt": string, "agent_type": "explore"|"plan"|"code" }`
  - 说明：创建子代理执行子任务并返回文本结果（见下一节）

> 代码里还实现了 `append_file`、`memory_save`、`memory_search` 等工具，但当前 CLI 未注册（因此“不可用”），见 `apps/agents-cli/src/core/tools/fs.ts` 与 `apps/agents-cli/src/core/tools/memory.ts`。

<a id="agents-cli-skills"></a>
## Skills（技能）系统

### 组织方式

- 目录：`skills/<skill-name>/SKILL.md`
- `SKILL.md` 必须包含 frontmatter：`name` 与 `description`，否则不会被加载（见 `apps/agents-cli/src/core/skills/loader.ts`）
- 资源提示：若同目录下存在 `scripts/`、`references/`、`assets/`，加载技能时会把可用文件名列出来（不自动读取内容）

### Frontmatter 限制（重要）

当前 frontmatter 解析是“手写简化版”，仅支持单行 `key: value`，不支持 YAML 多行（例如 `description: |` 的 block scalar）。编写技能时建议：

- `description` 用单行文本
- 复杂说明放在正文部分

### 仓库内置 skills（`apps/agents-cli/skills`）

- `code-review`：代码审查清单（安全/正确性/性能/可维护性/测试）
- `agent-builder`：智能体设计理念与模式（注意：其 frontmatter 当前是多行 YAML，描述可能显示不完整）
- `pdf`：PDF 读取/创建/合并相关命令与库
- `mcp-builder`：MCP Server 构建指南（Python/TS 模板）

<a id="agents-cli-task"></a>
## Task（子代理）与 agent types

子代理能力由 `apps/agents-cli/src/core/subagent/types.ts` 定义：

- `explore`：只读探索（允许 `bash`、`read_file`）
- `plan`：只读规划（允许 `bash`、`read_file`）
- `code`：实现/修复（允许 `bash`、`read_file`、`write_file`、`edit_file`、`TodoWrite`）

实现细节（见 `apps/agents-cli/src/cli/index.ts`）：

- 主代理通过 `Task` 工具创建子代理；子代理共享同一个 `AgentRunner`，但会通过 `allowedTools` 限制可用工具集合
- 模型约束：子代理必须继承父代理本轮实际使用的模型；若父代理本轮指定了 `modelOverride`，子代理也必须沿用同一模型，不允许静默退回 `AGENTS_MODEL` 默认值或其他模型
- 子代理默认不允许再次调用 `Task` 或 `Skill`（因为不在 allowlist 里），因此当前实现是“单层子代理”
- `maxSubagentDepth` 仍会在创建时检查（但在上述单层限制下通常不会触发）

<a id="agents-cli-memory"></a>
## 记忆（Session / Long-term）

### 会话续写（Session history）

- `agents run --session <id> "..."` 或 `AGENTS_TASK_ID=<id>` 会启用会话续写
- 历史保存为 JSONL：`<memoryDir>/sessions/<id>.jsonl`（默认 `.agents/memory/sessions`）
- 默认最多保留 200 条消息，并保留最早的那条“prelude”消息（见 `apps/agents-cli/src/core/memory/session.ts`）

为了避免 worktree/临时目录变化导致“同一任务没记忆”，可设置：

- `AGENTS_REPO_PATH=<repo-root>`：会优先把 session 写到该 repo 根目录下的 `<memoryDir>/sessions/`

### 长期记忆（Long-term notes）

`apps/agents-cli/src/core/memory/store.ts` 实现了一个简单的 JSONL notes store（`notes.jsonl`），并有对应工具 `memory_save`/`memory_search`（`apps/agents-cli/src/core/tools/memory.ts`），但当前 CLI 未注册；如需启用需要在运行时把工具注册到 `ToolRegistry`。

<a id="agents-cli-world"></a>
## agents-world 日志

配置 `worldApiUrl` / `AGENTS_WORLD_API_URL` 后，运行时会创建 `WorldLogger`（`apps/agents-cli/src/core/logs/world-logger.ts`）并通过 JSON-RPC 方式推送：

- `process.upsert`：启动进程
- `log.push`：stdout/stderr/event 等日志
- `process.status`：运行状态（ok/error/stopped）

`Task` 创建的子代理也会创建自己的 logger，并通过 `parentId` 关联到父进程，便于可视化追踪。

<a id="agents-cli-security"></a>
## 安全边界与已知限制

- 路径沙箱：`read_file`/`write_file`/`edit_file` 只能访问 `cwd` 内路径（防止越界读写）
- 危险命令拦截：`bash` 仅做非常粗的字符串拦截（不等价于完整 sandbox），仍需把 `cwd` 设在安全目录
- 输出截断：多个工具会截断输出（默认 50k 字符；logger 单条内容也会截断到 10k）
- `edit_file` 只替换“首次匹配”，对结构化代码改动不如 patch 稳定；更复杂的变更建议由外层工具（如 git diff/patch）辅助完成
- Skills frontmatter 不支持 YAML 多行（见上文限制）

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- After modifying code files in this session, run `graphify update .` to keep the graph current (AST-only, no API cost)
