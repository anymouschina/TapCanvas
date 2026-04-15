# TapCanvas 项目索引（for agents-cli）

> 目标：给后续开发/排障提供稳定索引入口，优先服务 `agents-cli` 检索与任务编排。

## 1. Monorepo 结构总览

- 根工作区：`pnpm-workspace.yaml`
- 前端画布：`apps/web`（Vite + React + Mantine + React Flow + Zustand）
- 后端 API：`apps/hono-api`（NestJS Node 进程 + 挂载 Hono 路由）
- 智能体 CLI：`apps/agents-cli`（agents-cli 主体）
- 共享包：`packages/schemas`、`packages/sdk`、`packages/cli`
- 文档：`docs`

## 2. 关键运行入口

- Web 开发：`pnpm dev:web`
- API 开发：`pnpm dev:api`
- Agents CLI（本地桥接常用）：
  - `pnpm --filter agents dev -- serve --port 8799`
- 构建：
  - Web：`pnpm --filter @tapcanvas/web build`
  - API：`pnpm --filter @tapcanvas/api build`

## 3. 核心业务链路（高频）

### 3.1 章节分镜生产（UI -> pipeline -> 画布）

- 前端入口：
  - `apps/web/src/ui/AssetPanel.tsx`
  - 关键函数：
    - `runStoryboardForChapter`
    - `ensureChapterStoryboardPlan`
    - `createAndRunStoryboardChunkNode`
    - `handleProduceChapterStoryboard`
- 后端入口：
  - `apps/hono-api/src/modules/agents/agents.routes.ts`
  - `apps/hono-api/src/modules/agents/agents.service.ts`
  - 关键函数：
    - `executeUserAgentPipelineRun`
    - `runStoryboardWorkflowGenerate`
    - `runStoryboardWorkflowShotEdit`
- API 客户端：
  - `apps/web/src/api/server.ts`
  - 关键调用：
    - `runStoryboardWorkflowGenerate`
    - `runStoryboardWorkflowShotEdit`
    - `runAgentPipelineRunExecute`

### 3.2 子图刷新（分镜子图纠错）

- 前端：
  - `apps/web/src/canvas/nodes/TaskNode.tsx`
  - `apps/web/src/canvas/nodes/taskNode/components/StoryboardImageContent.tsx`
- 后端：
  - `apps/hono-api/src/modules/agents/agents.service.ts` -> `runStoryboardWorkflowShotEdit`

### 3.3 分镜连续性元数据

- 项目书籍索引 API：
  - `apps/web/src/api/server.ts`
  - `getProjectBookIndex`
  - `upsertProjectBookStoryboardPlan`
- 后端持久化：
  - `apps/hono-api/src/modules/asset/asset.routes.ts`
  - `apps/hono-api/src/modules/agents/agents.service.ts`
- 本地数据文件（开发环境）：
  - `project-data/users/<userId>/projects/<projectId>/books/<bookId>/index.json`
- 关键字段：
  - `assets.storyboardPlans`
  - `assets.storyboardChunks`
  - `tailFrameUrl`

## 4. Agents CLI 优先策略（项目约束）

- 规范来源：`AGENTS.md`
- 原则：
  - 语义理解、功能决策、流程拦截优先走 `agents-cli`
  - 本地规则仅做结构性校验（空值/类型/数量/权限/边界）
  - 不使用本地硬编码规则覆盖 agents-cli 的语义结论

## 5. 模块定位速查（按改动意图）

- 改“章节生成分镜”按钮行为：
  - `apps/web/src/ui/AssetPanel.tsx`
- 改分镜节点 UI（单节点/展开/子图按钮）：
  - `apps/web/src/canvas/nodes/TaskNode.tsx`
  - `apps/web/src/canvas/nodes/taskNode/components/StoryboardImageContent.tsx`
- 改工作流生图/合图/续写后端逻辑：
  - `apps/hono-api/src/modules/agents/agents.service.ts`
- 改任务供应商路由/重试/轮询：
  - `apps/hono-api/src/modules/task/*`
  - `apps/hono-api/src/modules/apiKey/*`
- 改项目书籍索引数据结构：
  - `apps/hono-api/src/modules/asset/asset.routes.ts`
  - `apps/web/src/api/server.ts`

## 6. 高频排障入口

- 400/422（参数或流程前置失败）：
  - 先看前端调用参数：`apps/web/src/ui/AssetPanel.tsx`
  - 再看后端 `AppError` 抛出点：`apps/hono-api/src/modules/agents/agents.service.ts`
- “执行成功但未加到画布”：
  - 检查 `createAndRunStoryboardChunkNode` 是否实际创建节点
  - 检查节点 `kind` 是否为 `novelStoryboard`
- “续写不连续”：
  - 检查 `index.json` 的 `assets.storyboardChunks[*].tailFrameUrl`
- “agents bridge 调用失败”：
  - 检查 `AGENTS_BRIDGE_BASE_URL`、`AGENTS_API_BASE_URL`、网络超时

## 7. 建议检索命令（给 agents-cli）

```bash
# 找章节分镜主流程
rg -n "runStoryboardForChapter|ensureChapterStoryboardPlan|createAndRunStoryboardChunkNode" apps/web/src/ui/AssetPanel.tsx

# 找后端 workflow 主入口
rg -n "runStoryboardWorkflowGenerate|runStoryboardWorkflowShotEdit|executeUserAgentPipelineRun" apps/hono-api/src/modules/agents/agents.service.ts

# 找书籍元数据读写
rg -n "storyboardPlans|storyboardChunks|tailFrameUrl|getProjectBookIndex|upsertProjectBookStoryboardPlan" apps/web/src apps/hono-api/src
```

## 8. 维护约定

- 当新增“分镜/角色卡/连续性”能力时，同步更新本文件。
- 若入口文件迁移，保留旧路径一段时间并在本文件注明迁移关系。
- 该索引优先保证“可定位”与“可检索”，不追求完整设计文档替代。
