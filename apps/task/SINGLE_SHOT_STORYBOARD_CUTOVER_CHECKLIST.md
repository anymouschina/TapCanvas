# Single-Shot Storyboard Cutover Checklist

## Goal

将章节分镜能力收敛为“单镜头原子生产 + 历史上下文驱动连续性”的唯一范式：

- `tapcanvas-storyboard-expert` 只负责单镜头输出
- 多镜头一致性与关联性由历史档案注入（`project-data/`）
- 编排层按 N 个关键帧任务逐个调用 agents

## Completed Checklist

- [x] 明确目标边界：单镜头 skill 不再承担多镜头编排职责。
- [x] 升级单镜头 skill 协议到 `storyboard-director/v1.1`，覆盖 3D 建模 + 导演 + 定格动画关键字段。
- [x] 新增 `v1.1` schema：`apps/agents-cli/skills/tapcanvas-storyboard-expert/assets/storyboard-director-schema.v1.1.json`。
- [x] 后端章节分镜默认 required skill 切换到 `tapcanvas-storyboard-expert`：
  - `apps/hono-api/src/modules/agents/agents.service.ts`
- [x] 更新对应桥接测试中的 skill 名称断言：
  - `apps/hono-api/src/modules/task/task.agents-bridge.prompt-specialists.test.ts`
- [x] 更新 `apps/hono-api/README.md` 的 AI 对话架构说明，补充“单镜头 skill + project-data 连续性注入”规则。

### 同质化 Skill 清理（已完成）

- [x] 删除 `apps/agents-cli/skills/agents-team-novel-storyboard`
- [x] 删除 `apps/agents-cli/skills/novel-next-shot-storyboard`
- [x] 删除 `apps/agents-cli/skills/seedance-storyboard`
- [x] 删除 `apps/agents-cli/skills/shot-organization-method`
- [x] 删除 `apps/agents-cli/skills/tapcanvas-layout-planner`
- [x] 删除 `apps/agents-cli/skills/tapcanvas-novel-storyboard-e2e`
- [x] 删除 `apps/agents-cli/skills/tapcanvas`
- [x] 删除 `apps/agents-cli/skills/task-interrogation`
- [x] 保留 `apps/agents-cli/skills/tapcanvas-storyboard-expert`

### 历史上下文与编排策略（已固化）

- [x] 连续性来源固定为 `project-data/`（book index、storyboardChunks、tailFrameUrl 等）。
- [x] 参考图策略调整为“建议优先”：首镜可无参考图；非首镜通常应带参考图，但缺失时仅做诊断提示，不做强阻断。
- [x] 编排策略固定为：
  1. 读取用户需求与历史上下文
  2. 拆分为 N 个关键帧任务
  3. 逐镜头调用 agents（单镜头 skill）
  4. 每镜头判断是否存在上一帧/可复用资产引用
  5. 写回结果并继续下一镜头
- [x] 缺失关键连续性证据时采用显式失败，不做隐式补全。

### Verification Evidence（本轮）

- [x] 技能目录核验：仅目标单镜头 skill 保留，已删除项不在目录中。
- [x] 代码引用核验：`agents.service` 与 bridge tests 已切换到 `tapcanvas-storyboard-expert`。
- [x] 历史目录核验：`/Users/libiqiang/workspace/TapCanvas-pro/project-data` 存在并可读取。

## Cutover Result

- [x] 当前分镜生产能力已完成“单镜头中心化”切换。
- [x] 可按“单镜头做好 -> N 镜头编排”的方式稳定扩展。
