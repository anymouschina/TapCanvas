# agents

TypeScript 智能体执行内核：默认是通用型助手与编排器，在需要时再进入研究、审查、创作或实现姿态；支持 Skills、多代理协作与自学习记忆。

## 快速开始

```bash
cd agents
npm install
npm run build
npm link

# 初始化（生成配置、技能模板、记忆目录）
agents init

# 开发模式
npm run dev -- run "你好，先规划一个最小 MVP"

# 监听模式：skills/ 或 src/ 变化自动生效
npm run dev:watch -- run "你好，先规划一个最小 MVP"

# 自动 rebuild dist 并重启（用于调试构建产物）
npm run watch -- run "你好，先规划一个最小 MVP"
```

## 配置

`agents.config.json`：

```json
{
  "apiBaseUrl": "https://right.codes/codex/v1",
  "apiKey": "YOUR_KEY",
  "model": "gpt-5.2",
  "apiStyle": "responses",
  "stream": true,
  "memoryDir": ".agents/memory",
  "skillsDir": "skills",
  "maxTurns": 12,
  "maxSubagentDepth": 2,
  "agentIntro": "你不是单一的 code agent，而是一个通用型智能体助手与编排器..."
}
```

也可通过环境变量覆盖：
- `AGENTS_API_KEY`
- `AGENTS_API_BASE_URL`
- `AGENTS_MODEL`
- `AGENTS_API_STYLE`
- `AGENTS_STREAM=true|false`（HTTP `serve` 模式默认也会尊重它；只有显式传 `--no-stream` 才会强制关闭）
- `AGENTS_REQUEST_TIMEOUT_MS`
- `AGENTS_FETCH_RETRIES`（连接失败重试次数，默认 `1`，建议 `1~2`）
- `AGENTS_DNS_RESULT_ORDER=ipv4first|verbatim`（网络环境 IPv6 不稳定时建议 `ipv4first`）
- `AGENTS_MEMORY_DIR`
- `AGENTS_SKILLS_DIR`
- `AGENTS_WORLD_API_URL`
- `AGENTS_REDIS_URL`（会话缓存 Redis 地址；未设置时仅使用文件会话）
- `AGENTS_SESSION_CACHE_TTL_SECONDS`（会话缓存 TTL，默认 `600` 秒）
- `AGENTS_SESSION_CACHE_PREFIX`（会话缓存 key 前缀，默认 `agents:chat:session`）
- `AGENTS_PROFILE=general`（通用助手模式：禁用 shell 与本地文件读写工具，默认中文回答）
- `AGENTS_PROFILE=code`（执行增强模式：开放工程工具，但默认人格仍是通用助手，不应把所有任务自动收窄为编码）
- `AGENTS_PENDING_TEAM_WAIT_POLL_MS`（主代理完成前自动轮询未结束子代理的轮询间隔，默认 `500`）
- `AGENTS_PENDING_TEAM_WAIT_TIMEOUT_MS`（每次自动等待子代理的单轮超时，默认 `30000`）
- `AGENTS_PENDING_TEAM_WAIT_DIAGNOSTIC_AFTER_CYCLES`（达到该轮次后在 wait message / trace 中附加超预算诊断，默认 `4`；不会停止等待）
- `AGENTS_SUBAGENT_RUN_BUDGET_MS`（可选；覆盖子代理软 budget，默认继承 `capabilityGrant.budgets.maxWallTimeMs`）
- `AGENTS_SUBAGENT_PROGRESS_PERSIST_MS`（子代理文本进展快照的最小持久化间隔，默认 `2000`）
- `AGENTS_COMPLETION_SELF_CHECK_MAX_RETRIES`（连续 completion gate 阻断时的自修复重试预算，默认 `2`）
- `AGENTS_COMPLETION_SELF_CHECK_MAX_TOTAL_RETRIES`（单请求内 completion 自修复总重试上限，默认 `6`）
- `AGENTS_READ_FILE_BUDGET_PER_PATH`（同一轮内单文件允许的最大有效读取次数，默认 `3`；`read_file` / `read_file_range` 会阻止已覆盖区间的重复读取）

全局配置：
- 默认全局目录为 `~/.agents`，可用 `AGENTS_HOME` 覆盖（Docker 场景建议挂载该目录）
- 可在 `<AGENTS_HOME>/agents.config.json` 或 `<AGENTS_HOME>/.env` 放置配置
- 如果当前目录有 `agents.config.json` 且包含 `apiKey`，会自动缓存到 `<AGENTS_HOME>/agents.config.json`

日志可视化（agents-world）：
- `worldApiUrl` / `AGENTS_WORLD_API_URL` 用于推送日志到 `agents-world` 后端（默认 `http://localhost:8787`）

## 命令

- `agents init`
- `agents run "你的任务"`
- `agents run --session <id> "续写同一会话"`
- `agents` (默认进入交互式 REPL)
- `agents repl`
- `agents repl --session <id>`（在 TUI 内绑定/恢复指定会话）
- `agents sessions`（列出最近会话，便于恢复）
- `agents resume [id]`（直接恢复指定或最近会话并进入 TUI）
- `agents serve`（启动 HTTP 服务，便于与其他进程通信）
- `agents global-init`（写入 `<AGENTS_HOME>/agents.config.json`）

构建/安装后自动同步：
- `npm run build` 与 `npm install` 会自动把当前 `agents.config.json` 或 `.env` 同步到 `<AGENTS_HOME>/agents.config.json`
- `npm run build` 与 `npm install` 也会同步 `dist/` 与 `skills/` 到 `<AGENTS_HOME>/dist` 和 `<AGENTS_HOME>/skills`
- `agents skill new <name>`

## Skills

在 `skills/<name>/SKILL.md` 内使用 YAML frontmatter 描述技能元信息，正文按需加载。
运行时会递归扫描当前 `workspaceRoot` 下所有名为 `skills` 的目录，聚合其中子目录里的 `SKILL.md` 元数据；同名 skill 以后发现者覆盖先发现者。
除工作区内的 `skills/` 外，运行时仍会额外纳入 `apps/agents-cli/skills`（bundled skills）与 `<AGENTS_HOME>/skills` 中的可用 skill。
每次对话的运行时规则会追加一条实验性约束：当现有 skill 无法满足任务质量要求时，可以新增 skill，但禁止删除、覆盖或修改任何现有 skill。

常用内置技能示例：
- `agents-team`：提供通用多代理协作方法论与角色分工建议
- `long-running-app-harness`：为长跑应用开发任务提供 planner -> contract -> build -> evaluator 协议

## 自学习记忆

- 运行时默认使用分层 memory，而不是单一 `notes.jsonl`：
  - `sessions/<id>.jsonl`：会话原始消息历史
  - `session-rollups/<id>.json|md`：每次 run 后自动生成的会话压缩摘要
  - `memory-candidates/runs/<sessionId>/<timestamp>.json`：stage-1 候选记忆，只记录本轮可复用候选事实
  - `memory-candidates/consolidated.json|md`：stage-2 聚合结果，对重复 run path 做去重合并
  - `memory_summary.md`：自动汇总的紧凑运行时摘要，会在下一次 run 前注入 system prompt
  - `MEMORY.md` / `index.json`：面向人工排查与续跑的详细索引
  - `notes.jsonl`：长期记忆条目（`core` / `episodic` / `semantic` / `procedural` / `vault`）
- `AgentRunner` 会在每次根代理 run 前自动读取 `memory_summary.md`、当前 session rollup、相关 note 命中，以及 stage-2 consolidated candidates，并把压缩后的 `Persisted Memory` 片段注入 system prompt。
- `AgentRunner` 会在每次根代理 run 结束后按顺序刷新：session rollup -> stage-1 candidates -> stage-2 consolidation -> `memory_summary.md` / `MEMORY.md` / `index.json`；子代理默认只读共享记忆，不会自动覆盖根代理 session rollup。
- `memory_search` 不再只查 `notes.jsonl`；现在会联合检索长期 note、session rollup 与 consolidated candidates，并返回分层命中结果（`kind=note|session_rollup|consolidated_candidate`）。
- `memory_save` / `memory_forget` / `memory_reflect_commit` 成功后会自动刷新 summary artifacts，避免工具写入后 prompt 仍然读取旧摘要。
- `TodoWrite`：更新任务清单
- `Skill`：加载技能正文
- `memory_save` / `memory_search` / `memory_forget` / `memory_reflect` / `memory_reflect_commit`：长期记忆与反思审批
- `task_create` / `task_update` / `task_get` / `task_list` / `task_claim`：持久化任务图主控制面
- `exec_command` / `write_stdin` / `exec_list`：会话式终端执行（支持 `session_id` 轮询与持续输出）
- `background_run` / `background_get` / `background_list`：后台任务执行与结果回注

## agents team 模式（多代理）

`code` profile 下默认注册多代理工具，但 runtime 仍默认单代理优先；只有任务复杂且拆分有明确收益时，才应进入 team 模式。`agents-team` 现在是可选方法论 skill，不再承担工具开关职责。

- `spawn_agent` / `send_input` / `resume_agent` / `idle_agent` / `wait` / `close_agent` / `list_agents`
- `agent_workspace_import`
- `mailbox_send` / `mailbox_read`
- `protocol_request` / `protocol_read` / `protocol_respond` / `protocol_get`

`Task` 已不再作为正式多代理主路径；当前推荐编排方式是 `orchestrator + task_* + spawn_agent + mailbox_* + protocol_*`。

并且必须通过 `agent_type` 显式声明角色后才会实际使用。当前内置 team 角色：

- `orchestrator`：规划、拆分、并行调度、汇总
- `worker`：实现边界清晰的代码/执行任务
- `reviewer`：以审查为主，专注风险和缺失验证
- `research`：以取证和资料整理为主
- `writer`：以起草内容或结构化草稿为主
- `editor`：以统一风格、去重、收敛表达为主

`spawn_agent` 额外支持 `fork_context: true`，可把父代理当前上下文直接带给子代理，适合在已经完成一轮事实收集后继续拆分执行。forked history 现在会先做一次净化：只复制父级历史里“assistant tool call 与后续 tool output 已完整闭合”的消息链；当前回合尚未回填输出的 in-flight tool call，以及失配的孤儿 tool output，会在复制前被显式剔除，避免 Responses API 因 `No tool output found for function call ...` 拒绝子代理启动。
`spawn_agent` 还支持 `autonomous: true` 与可选 `task_id`：可在创建时直接认领持久化任务，并在当前工作结束后继续轮询任务板自动认领新任务。若 `task_id` 已被当前父代理自己持有，工具层会自动去掉这次对子代理的重复绑定，避免把同一任务再错误认领给 child；若 `task_id` 已被其他 owner 占用，则非 autonomous helper 会显式跳过这次 task 绑定，并在返回 JSON 里附带 `task_binding.status=skipped_existing_owner` 与 `owner/reason`，避免把整轮 trace 直接打成失败；只有 autonomous agent 仍会在入口原地失败，并明确提示“如只需未绑定 helper，请省略 task_id”，同时不会残留一个 `queued` 的空壳 agent 记录。
`resume_agent` 可重新打开已 `close` 的 agent，供后续继续 `send_input`。
`idle_agent` 可让 team agent 显式声明“当前无活跃执行，进入 idle”；autonomous agent 在没有新任务可认领时也会自动进入 `idle`。
`spawn_agent` 和 `send_input` 都会返回 `submission_id`；`wait` 可同时等待 agents 与 `protocol_request` 生成的 `request_id`，并回收 submission / request 状态。
`status` / `list_agents` / `wait` 返回的 agent 摘要现在包含 `model` 字段，可用于核对子代理是否继承了父代理本轮实际模型。
当主代理在本轮已经 `spawn_agent` / `send_input` / `resume_agent` 过 team agent，且这些子代理仍有真实待处理工作（`pending_tasks > 0`、存在 `active_submission_id`，或仍有 `queued/running` submission）时，runtime 不会等到“准备结束”才补等，而是会在进入下一次 LLM 轮次前持续自动轮询到子代理进入终态；若同一条 assistant 响应里在 team tool 之后还排了别的工具，这些后续工具会被显式标记为 `blocked`，要求下一轮按最新子代理终态重新决策。仅 `status=queued` 但没有任何 pending work / submission 的空壳 agent，不再触发等待。这段自动等待不占用 `maxTurns`，也不计入 completion self-check 重试预算；单轮 wait timeout 只会记一条成功态 `agents_team_runtime_wait` trace，然后继续下一轮 runtime wait。除了“最大轮次”和“child 已超预算”之外，runtime 现在还新增了父代理侧的总等待时长上限 `AGENTS_PENDING_TEAM_WAIT_MAX_TOTAL_MS`（默认 `90000ms`）：它独立于 child 自身的 soft budget，用来避免父代理被固定 30s 轮询拖到数分钟。若等待已达到最大轮次、命中这条总时长上限，或 child 长时间超预算，runtime 会停止继续自动轮询，并把 `stopped=true`、`stopReason`、`overBudgetDiagnostics` 写进一条失败态 `agents_team_runtime_wait` trace，由父代理决定是关闭卡住的 child、只基于已确认事实继续，还是显式向用户报告失败；deterministic completion gate 也会把这条 failed trace 视为运行时失败事实，不再继续自动等待同一批 pending child。对子代理自身，collab runtime 不再用 watchdog 强制 abort；改为把 `capabilityGrant.budgets.maxWallTimeMs`（或 `AGENTS_SUBAGENT_RUN_BUDGET_MS`）视为软 budget。若 child 仍在运行，runtime 会把 `run_elapsed_ms / budget_ms / over_budget_ms / last_progress_*` 写进 submission 状态，并在 wait message / trace 里附带 `overBudgetDiagnostics`，让父代理基于事实分析它为什么超预算，而不是在证据不足时主观归因。
若某个 child 已被 `close_agent` 成功关闭，runtime 现在会把该 child 视为终态，不会再因为持久化状态里暂时残留的 `pending_tasks`、`active_submission_id` 或旧 `running` submission 摘要继续自动等待；若确实仍要继续依赖它，必须显式 `resume_agent` 或重新发起 `wait`。
`mailbox_send` / `mailbox_read` 用于持久化异步协作消息，适合跨重启保留交接信息，而不是依赖父代理短期上下文。
`protocol_*` 用于显式 request/reply 协议：适合需要结构化交付、可追踪响应状态、后续可轮询回收结果的协作场景。
若 `/chat` 上游传入 `allowedSubagentTypes`，`spawn_agent` 会按该白名单做硬拦截；不在允许列表内的 `agent_type` 会显式失败，而不是仅把约束停留在 prompt 里。
`task_claim` 会把任务 owner 与当前 execution lane 一起持久化到任务板；对 worker，lane 默认指向其私有 `agentWorkRoot/repo` staged repo 根。
任务 lane 现在是硬约束而不是提示信息：`task_claim` / autonomous claim 只会认领 lane 为空或与当前 agent lane 一致的任务；lane 不匹配会显式失败，不再允许跨 lane 抢任务。
`background_run` 会在后台执行命令，并在后续 LLM 回合开始前把已完成结果自动注入消息上下文，无需手动轮询才能让模型感知结果。
`exec_command` 会返回一次输出快照；当命令仍在运行时会返回 `session_id`。后续可通过 `write_stdin`（`chars=""`）做空输入轮询，持续拉取输出与完成状态，形成“等待后台终端”的会话化自检流程。
autonomous agent 的轮询间隔与 idle 超时由 `AGENTS_AUTONOMOUS_POLL_MS` 与 `AGENTS_AUTONOMOUS_IDLE_TIMEOUT_MS` 控制；默认分别为 `5000ms` 与 `60000ms`。若持续 idle 超时，agent 会自动 `close`，而不是无限挂起。
team sub-agent 现在会继承父级 capability grant 的工具、读写根和网络预算；runtime 会按角色继续收紧继承边界：所有 child 都会显式移除继续派生子代理的工具（如 `spawn_agent` / `Task`），而非 `orchestrator` child 还会额外移除 `send_input`、`resume_agent`、`wait`、`close_agent`、`list_agents` 与 `agent_workspace_import` 这类团队编排控制工具，只保留 mailbox / protocol 这类受限协作通道。因此 `research` / `writer` / `editor` / `reviewer` / `worker` 不再可能因为继承父 grant 而误拿到 team 调度权。角色 prompt 只表达职责偏好，真实硬边界仍由 grant 和 allowedTools 决定；`write_file` / `edit_file` 与部分 `bash` 文件命令继续按 grant 根路径硬拦截。
team sub-agent 也会继承父代理本轮实际生效的模型；若父级通过 `model` / `modelAlias` / `modelKey` 覆盖了模型，子代理会沿用同一模型继续执行，而不是悄悄回落到默认模型。
`worker` 的默认 `cwd` 会切到私有 `agentWorkRoot/repo` staged repo 根目录，这样默认相对写入就是“待 orchestrator 导入”的仓库文件；共享仓库根会通过 `sharedWorkspaceRoot` 元数据和 shell 环境变量 `AGENTS_SHARED_WORKSPACE_ROOT` 暴露，适合显式只读访问主仓库内容。
shell 还会暴露 `AGENT_WORK_ROOT`（私有工作区根）与 `AGENT_REPO_STAGING_ROOT`（待导入 repo staged 根）；非 repo 交接物应写在 `agentWorkRoot`，待导入的仓库文件应写在 `agentWorkRoot/repo`。
agent 完成后会在私有工作区写出 `artifacts.json` 与 `handoff.json`，并通过 `status/list_agents/wait` 返回 `artifact_count`、`recent_artifacts` 与 `handoff_file_count` 摘要，方便 orchestrator 回收交付物。
`agent_workspace_import` 仅允许针对 `worker` agent 使用，且只会导入 `agentWorkRoot/repo` 下的普通文件；`.agents`、`.git` 等保留路径不会进入 handoff 清单。`mode` 必须显式为 `dry_run` 或 `apply`，不会再静默降级。
`dry_run` 现在会返回每个文件的 `import_decision`（`create` / `unchanged` / `conflict`）以及汇总 summary，供 orchestrator 先审计再落地。
`agent_workspace_import` 现在还会返回 `audit`：包括 agent 身份、workspace lane、claimed task id/subject/owner/lane，方便把 staged handoff 与任务板责任链对齐。
`apply` 默认使用 `conflict_policy=fail`：只要目标文件内容与 staged 文件不同，就会显式失败而不是偷偷覆盖；只有显式传入 `conflict_policy=overwrite` 才允许覆盖冲突文件。

内置 team Skill：
- `agents-team`：通用多代理协作方法论
- `long-running-app-harness`：长跑应用构建协议，强调 spec、contract、skeptical evaluator 与 import gate

## Runtime 架构（当前）

当前版本已经从“CLI 入口直接装配一切”切到 `runtime + surfaces + core` 的分层：

- `src/runtime/runtime.ts`：`AssistantRuntime` 门面。负责装配 runner、tool registry、memory/tasks/team/background services，并向 CLI / TUI / HTTP 暴露统一的 `toolContextMeta`、session store 与 shutdown 能力。
- `src/runtime/channel.ts`：渠道描述层。统一声明当前 run 来自 `tui` / `http` / `shell` 等哪种 channel、交互传输方式（interactive / request_response / stream）、以及关联的 session/user/surface 元信息；同时会导出共享的 channel policy（如 `compact` vs `balanced` 响应风格、sessionMode、eventMode），并把这些事实注入 runner 的 `toolContextMeta.runtimeChannel/runtimeChannelPolicy`，避免不同 surface 再各自私藏渠道语义或各自补 prompt。
- `src/runtime/events.ts`：共享 runtime event schema；surface 不应再各自发明一套 run/text/tool/turn 生命周期事件。当前已包含 `run.started`、`tool.started`、`text.delta`、`todo.updated`、`tool.completed`、`turn.completed`、`run.completed`、`run.failed`。
- `src/runtime/profile.ts` / `src/runtime/session.ts` / `src/runtime/skills.ts`：把 profile 决策、session 定位、skills 发现从命令入口剥离出来，避免 `index.ts` 再次膨胀成系统总控。
- `src/surfaces/cli/*`：CLI surface，只负责 stdin / stdout 与工具输出预览。
- `src/surfaces/tui/*`：TUI / REPL surface，只负责交互输入、转录展示、斜杠命令和 run 可视化，不再直接承担 runtime 装配。
- `src/server/http-server.ts`：HTTP surface，继续使用同一套 `AssistantRuntime` 产出的 runner、system override 与 tool context。流式 SSE 事件不再直接绑定原始 runner 回调，而是先接收 runtime event，再投影为 `thread/item/content/tool/todo/result/done` 等 HTTP 事件。
- `src/core/agent-loop.ts`：主执行内核，负责 LLM turn、tool batching、planning gate 与 team runtime 协调。
- `src/core/session/session-engine.ts`：托管 message stack、runtime meta、tool runtime state，以及运行中的 system/message 更新。
- `src/core/context-pipeline.ts`：组装 persona、workspace rules、memory、runtime diagnostics、generation contract、canvas capability、request scope，并输出 `contextDiagnostics`。
- `src/core/capability-plane.ts` / `src/core/capability-resolver.ts` / `src/core/policy-engine.ts`：分别负责 capability 汇总、grant 解析、工具裁决。
- `src/core/finish-policy.ts`：统一处理 run 结束时的 hook 上报、root memory sync 与错误上报。

当前目标不是复制 `claude-code-main` 的整套平台复杂度，而是先把 `agents-cli` 稳定成一个“共享内核 + 多入口 surface”的助手 runtime。后续新增 TUI overlay、外部 SDK 或 bridge 行为，应优先挂到 `AssistantRuntime` 与 `surfaces/*`，而不是把装配逻辑重新塞回 CLI 入口。

## TUI 体验（当前）

- TUI 现在采用终端原生 scrollback 模式，不再维护一个本地分页 transcript viewport。用户消息、assistant 回复、tool 摘要和 system note 会直接打印进终端历史，滚动行为交给终端本身处理。
- composer 仍然保留在当前输入区，负责多行编辑、斜杠补全、session picker 与运行态 status；运行中状态默认收敛在底部 footer，而不是额外插入大块固定状态面板；历史回复不再被截进固定面板里。
- 当上一条消息仍在运行时，composer 不会锁死；你可以继续输入并按 `Enter` 发送，后续消息会进入本地队列并在当前 run 完成后按顺序消费，不会因为运行中状态而丢失。
- TUI 现在会通过共享 channel contract 把“交互式终端默认短答优先”注入 runner：简单问答默认 1 段或少量要点，不应为了显得完整而重复同一结论；若受权限/路径/输入阻塞，优先短路说明缺口和下一步，而不是顺手附送长篇泛化方案。
- `run.started` / `tool.started` / `todo.updated` / `tool.completed` / `turn.completed` / `run.completed` / `run.failed` 这类 runtime 事件仍会进入 TUI 运行时状态，并以 system/tool/status 转录项打印到 scrollback，而不再依赖顶部固定 timeline 面板。
- `/sessions` 不再只是打印文本列表；现在会打开内置 `session picker`，可用上下键切换，按 `Enter` 直接恢复，按 `Esc` 关闭。
- `/resume` 现在支持两种形式：
  - `/resume`：直接打开 session picker
  - `/resume <id>`：按会话 key 恢复
  - `/resume <number>`：按最近会话列表序号恢复

## 注意

- 当前版本支持流式与非流式；若服务端返回 SSE，将自动解析。
- 当 `/chat` 上游 LLM 请求直接失败（例如 502/504、网关超时、fetch timeout）时，HTTP server 现在会把标准化 `code/details` 一并写入错误响应；其中 `details.requestSummary` 至少包含本次真实上游 LLM 调用的 `apiStyle/model/systemChars/approxPayloadChars`，以及 user/assistant/tool history 的字符占比和最大 tool 输出块大小，便于区分“请求过大”与“上游生成过慢/网关超时”。
- `system` prompt 在 `/v1/responses` 可用，默认启用。
- 当某一轮模型不再继续发 tool call 时，运行时会先执行一次 completion gate / final self-check，再决定是否允许结束。
- 若 `/chat` 的 completion gate 判定 `allowFinish=false`，runtime 不会只把这次阻断写进 trace 就结束；它会在同一 HTTP 请求内追加一个内部 `<runtime_completion_self_check>` 提示，把 `failureReason`、`rationale`、`missingCriteria`、`requiredActions` 与 planning 状态事实回灌给主代理继续修正。
- 内部 completion self-check steer 以 `ephemeral` user message 注入：模型可见，但不会写入 JSONL 会话历史或 Redis session 缓存；最终 trace 仅保留 `completion.retryCount` 与 `completion.recoveredAfterRetry` 这类运行时摘要。
- completion self-check 的重试预算按“连续 finish 失败”计算；只有 blocked 状态的关键证据真正前进时，连续预算才会归零。单纯重复 `flow_get`、`books_list`、`pipeline_runs_list` 这类读操作，或做了无效探测但没有补齐 checklist / 前置资产，不再被当作有效纠偏。
- 若上游远程工具同时提供“读已持久化状态”和“写回状态”两类接口，运行时应优先通过只读工具取证；不要拿写接口做存在性探测，否则这类无效调用不会被视为 blocked state 前进。
- completion self-check 还有独立的单请求总重试上限；若连续预算或总预算任一耗尽后仍未满足完成态，runtime 会保留 blocked completion 事实并显式结束，而不是继续输出伪完成态。
- `read_file` / `read_file_range` 现在会记录同一轮内每个文件已读取的覆盖窗口；若模型重复读取已覆盖区间，或对同一文件的探索超过预算，会直接显式失败，强制收敛而不是继续空转。
- final self-check 看到的工具证据不再只是一行 `toolName [status]` 摘要；现在会附带关键参数与输出预览，例如 `Skill.skill`、`spawn_agent.agent_type/promptPreview`、`wait/list_agents` 中的子代理终态与 submission prompt/result 预览，避免因摘要过弱而误判“缺少已执行证据”。
- 对图片、视频、关键帧等生成任务，final self-check 默认核对的是提示词约束、执行动作、真实产物交付与落点；除非用户明确要求审核/验收/比较，否则不会把结果级视觉审图当成默认完成前置。
- 若 `/chat` 请求显式设置 `requireAgentsTeamExecution=true`，则 completion gate 会在允许结束前额外核对本轮 trace 中是否已有真实 `agents-team` 执行证据；没有 `spawn_agent` / `send_input` / `resume_agent` / `mailbox_*` / `protocol_*` / `agent_workspace_import` 等成功记录时，运行时会强制续跑，禁止单代理直接结束。
- 若本轮已经成功拉起 team agent，且这些子代理仍有真实待处理 submission / pending work，runtime 会在继续下一次 LLM 轮次前先自动等待它们完成，再把最新状态回灌给主代理；若同一轮里 team tool 后面还有其他工具调用，这些调用不会继续落地，而会被显式标成 `blocked`。`queued` 但无 pending task、无 active submission、无未完成 submission 的空壳 agent 不会再触发等待。这段等待走独立 runtime 预算，不消耗生成轮次或 self-check 重试次数。

## HTTP 服务（进程通信）

用于让任意本地或局域网内进程通过 HTTP 调用 agents 进程。

```bash
# 在 apps/agents 目录（或使用 pnpm filter）启动
pnpm --filter agents dev -- serve --port 8799

# 然后在调用方配置
# AGENTS_BRIDGE_BASE_URL="http://127.0.0.1:8799"
```

是否对上游 LLM 使用流式请求，默认由 `apps/agents-cli/agents.config.json`、`~/.agents/agents.config.json` 或 `AGENTS_STREAM` 决定；只有显式传 `--no-stream` 时，`serve` 才会强制关闭流式。

服务端点：

- `POST /chat`：执行一次 agent run
- `GET /health`：健康检查
- `GET /collab/status`：读取当前 team agents/submissions 运行态
- `GET /collab/status?ids=<agentId1>,<agentId2>`：只读取指定 agents 的运行态

`POST /chat` 现在还支持上游按请求注入远程业务工具：

- `remoteTools`: 当前会话可见的工具定义数组（name / description / parameters）
- `remoteToolConfig`: 远程执行配置（例如 `endpoint`、鉴权信息、默认 project/flow/node 作用域）
- `allowedSubagentTypes`: 限制本轮 `spawn_agent` 可使用的 team 角色白名单
- `requireAgentsTeamExecution`: 要求本轮结束前先产生真实 team tool 执行证据

`agents-cli` 只负责把这些远程工具暴露给模型并在调用时回调执行；业务工具定义与真实执行逻辑应收口在上游服务，而不是内置到 `agents-cli` 本体。

Checklist/todo 对齐能力（与 codex-main thread item 语义保持一致方向）：
- 当本轮调用 `TodoWrite` 成功时，`/chat` 流式事件会额外发送 `event: todo_list`，包含结构化 `items[]`、`totalCount`、`completedCount`、`inProgressCount`。
- 若 `/chat` 在流式过程中失败，`event: error` 现在除了 `message` 之外，还会在可用时携带 `code/details`；bridge 或上游可以直接消费 `details.requestSummary` 查看最后一次真实 LLM 请求摘要，而不必再只靠服务端控制台日志排查。
- 非流式与流式最终 `result.trace` 中会附带 `todoList` 快照，便于上游 bridge/UI 做门禁与可视化。

提示：若要使用仓库内置 skills，可在启动 agents 进程时设置：

- `AGENTS_SKILLS_DIR=skills`（默认值；当通过 `pnpm --filter agents ...` 启动时会在 `apps/agents-cli` 目录运行）
- 新版运行时会聚合当前工作区内所有 `skills/`、`<AGENTS_HOME>/skills` 与“可执行文件同级 skills”，全局安装和 Docker 启动无需手动拷贝 skills。

## Docker 启动建议

- 建议设置并持久化：`AGENTS_HOME=/data/.agents`
- 挂载卷：`-v agents_home:/data/.agents`
- 首次镜像内构建后，`dist` 与 `skills` 会自动同步到该目录；后续容器重启可直接使用。

## 会话续写（跨多次运行保持上下文）

默认情况下，每次 `agents run` 都会从空上下文开始；要让多次运行共享同一段对话历史，请提供稳定的 session key：

- CLI：`agents run --session <id> "..."`（同一 `<id>` 会复用历史消息）
- TUI：`agents repl --session <id>`，或在 REPL 内使用 `/new [id]`、`/resume <id>`、`/sessions`
- 环境变量：`AGENTS_TASK_ID=<id>`（`agents-world` 后端启动进程时会自动设置）

会话历史保存为 JSONL：`<memoryDir>/sessions/<id>.jsonl`（默认 `.agents/memory/sessions`）。
同目录会维护一个 `_index.json`，用于把原始 session key 映射回可列出的最近会话摘要，因此 `agents sessions` 和 TUI `/sessions` 会显示原始 key、更新时间、消息数与最近预览。

同一 memory root 下还会自动生成：

- `session-rollups/<id>.json|md`
- `memory-candidates/runs/<sessionId>/<timestamp>.json`
- `memory-candidates/consolidated.json|md`
- `memory_summary.md`
- `MEMORY.md`
- `index.json`

如果设置了 `AGENTS_REPO_PATH`，会优先把会话写到该 repo 根目录下（而不是当前工作目录），避免 worktree/临时目录变化导致“同一任务看起来没记忆”。

HTTP `/chat` 模式下，memory 默认按 `userId` 隔离到 `<memoryDir>/users/<userId>/...`；`memory_*` tools 与自动 summary/rollup 都会使用该 user-scoped root，避免跨用户串记忆。运行时为了 completion 自修复而注入的内部 `ephemeral` 提示不会进入这套持久化历史。
