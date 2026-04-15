# Public Chat Hono API Boundary Cutover Checklist

目标：把 `hono-api` 在 `/public/chat -> agents bridge` 链路中的职责收敛为“权限/协议边界层”，不再向 `agents-cli` 注入行为型编排。

## 目标边界

- `hono-api` 只负责用户、项目、flow、node、资产的访问隔离。
- `hono-api` 只负责注入事实型上下文、画布工具 manifest、协议 schema、trace 元数据。
- `agents-cli` 负责意图识别、任务规划、技能加载、子代理编排与执行决策。
- 前端只展示真实 runtime 事实，不把 `TodoWrite` 误当作唯一规划形态。

## 本次改动清单

- [x] 删除 `/public/chat` 基础 system prompt 中的行为型约束。
- [x] 删除 `/public/chat` response policy 对回复形态的行为引导。
- [x] 删除 runtime skill hints 的后端注入，保持 `agents-cli` 自主加载 skill。
- [x] 删除 bridge 转发给 `agents-cli` 的额外行为围栏：
- [x] `【画布计划协议】`
- [x] `【结果透明要求】`
- [x] `selectedNode` 固定处理建议
- [x] `localResourceGuard` 文案式读取顺序约束
- [x] 保留用户/项目作用域校验与远程工具作用域隔离。
- [x] 保留 `canvasCapabilityManifest`、remote tools、事实型 `chatContext` 注入。
- [x] 更新 `apps/hono-api/README.md` 中“AI 对话架构（当前）”描述，反映新的职责边界。
- [x] 更新相关测试，验证 system prompt 不再包含行为围栏。

## 验证项

- [x] `buildPublicChatBaseSystemPrompt()` 仅输出身份与最小运行时边界说明。
- [x] `buildPublicChatResponsePolicyPrompt()` 不再注入行为型回复策略。
- [x] `buildPublicChatRuntimeSkillPrompt()` 对 public chat 返回空字符串。
- [x] bridge 转发到 `agents-cli /chat` 的 `systemPrompt` 不再包含 `【结果透明要求】` 与 `【画布计划协议】`。
- [x] 项目/画布作用域与 `canvasCapabilityManifest` 继续随请求透传。
