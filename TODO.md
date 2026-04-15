# TODO

## 已完成

### Memory 基础能力
- [x] 新增用户维度 memory 模块，提供 `/memory/write`、`/memory/search`、`/memory/context`、`/memory/trace`
- [x] memory scope 按 `user / project / book / chapter / session / task` 分层
- [x] memory type 支持 `preference / domain_fact / artifact_ref / summary`
- [x] `/public/chat` 对话完成后持久化 conversation turn 到 memory/session
- [x] storyboard chunk 产出后回写 continuity 相关 memory（artifact ref + domain fact）

### P1：Memory FTS
- [x] memory 搜索切到 PostgreSQL FTS
- [x] 为 `memory_entries` 增加 GIN FTS 索引
- [x] 搜索使用 `to_tsvector + plainto_tsquery + ts_rank_cd` 排序
- [x] tag 条件检索保留并与 FTS 组合

### P2：Memory Summary / Rollup
- [x] 新增 `summary` 记忆类型
- [x] 对话 turn 持久化后自动生成 session rollup
- [x] storyboard chunk 写回时自动生成 project / book / chapter rollup
- [x] `/memory/context` 返回 `rollups + summaryText + promptText`
- [x] agents bridge debug 日志增加 memory context rollup 摘要

### P3：更多前端业务节点显式消费 `/memory/context`
- [x] 章节 storyboard pipeline 执行前显式请求 `/memory/context`
- [x] 将 memory `promptText` 注入章节 storyboard pipeline 的 `systemPrompt`
- [x] 手动 storyboard chunk 生图前显式请求 `/memory/context`
- [x] 将 memory 摘要拼入 storyboard 镜头生成 prompt

### 调试与可观测性
- [x] 新增 `/memory/search` 可视化调试面板
- [x] 新增 `/memory/context` 可视化调试面板
- [x] `/memory/context` 面板展示 rollups / facts / artifact refs / recent conversation
- [x] agents bridge 调试日志输出 memory context 摘要

### 构建验证
- [x] `pnpm --filter ./apps/hono-api build`
- [x] `ALLOW_LOCALHOST_IN_PROD_BUILD=1 pnpm --filter @tapcanvas/web build`

## 当前实现要点
- Memory 后端入口：`apps/hono-api/src/modules/memory/`
- Agents bridge 注入 memory context：`apps/hono-api/src/modules/task/task.agents-bridge.ts`
- 前端 storyboard 业务消费 memory：`apps/web/src/ui/AssetPanel.tsx`
- 前端 memory 调试面板：`apps/web/src/ui/stats/system/`

## 待办

### 高优先级
- [ ] 把“用户接受 / 驳回 / 保留最终版本”的结果反馈写回 memory
- [ ] 增加 memory 去重 / supersede 机制，避免 summary 与 continuity 记录无限堆积
- [ ] 为关键 memory 写入点补更明确的 trace / source 语义，方便回溯“哪次任务写入了哪条记忆”

### 中优先级
- [ ] 扩展更多前端业务节点显式消费 `/memory/context`（不仅限 storyboard）
- [ ] 在 UI 上增加 memory 来源说明，区分 `事实 / 摘要 / 资产锚点 / 最近对话`
- [ ] 为 memory search/context 增加更细粒度过滤（sourceKind / importance / scope 组合）
- [ ] 为 summary/rollup 增加覆盖/替代策略，而不是持续追加新条目

### 自进化闭环
- [ ] 记录用户实际采用的 prompt / 产物 / 修改路径
- [ ] 记录用户手动改写后成功的版本，沉淀为 preference / summary
- [ ] 将“成功策略”与“失败原因”结构化写入 memory / trace
- [ ] 让后续 agent / storyboard / 生产节点优先消费这些成功经验

### 后续可选
- [ ] 增加 memory 质量巡检页面，查看低价值/重复/过期记忆
- [ ] 增加 rollup 刷新任务，按 session/chapter/book 周期性重整摘要
- [ ] 为 memory 写入与消费增加自动化测试
