# Agents Bridge 脏分支清理 Checklist

## 目标

把 `apps/hono-api -> task.agents-bridge` 剩余的本地语义分支、case patch 和方法论膨胀继续收口到：

- bridge 只保留协议编排、结构校验、硬约束注入与事实性 diagnostics
- 语义判断、创作方法、交付偏好与自修复默认回到 `agents-cli` / skills / specialists
- 不再让 `hono-api` 通过 prompt 猜测、自然语言标题判重、模糊匹配或超长工具说明承担隐式语义决策

## Checklist

- [x] 交付验收不再通过本地关键词/正则扫描 task 文本猜测“单基底帧 / 多镜头分镜”
- [x] `expectedDelivery` 只接受结构化 `deliveryContract` 与真实 scope/context 事实
- [x] bridge 不再从用户 prompt 本地提取 `chapterId`
- [x] 章节作用域只接受显式 request 字段或 selected reference/context 事实
- [x] 参考图/资产输入注入不再依赖 `【参考图】` / `【资产输入】` 这类自然语言标题做判重
- [x] 运行时参考上下文统一改为内部 `<tapcanvas_runtime_reference_context>` 哨兵块
- [x] `tapcanvas_flow_patch` tool description 从“创作方法论 + 交付偏好”收口为“协议 + 硬约束 + 结构约束”
- [x] `tapcanvas_flow_patch` description 不再宣称“优先做多镜头 stills / 不要只有 base frame + video placeholder”这类创作 SOP
- [x] `@角色#状态` 绑定不再使用 substring/includes 模糊匹配
- [x] `@角色#状态` 绑定改为显式归一化后的确定性匹配
- [x] `public-chat-execution-planning.ts` 复核为纯 scope/input 事实门禁，不属于污染
- [x] `apps/web/src/ui/chat/AiChatDialog.tsx` 的 malformed canvas plan tag 检测复核为结构解析，不属于污染
- [x] `apps/web/src/ui/chat/replyDisposition.ts` 复核为 UI 展示逻辑，不属于污染
- [x] `apps/web/src/ui/chat/canvasPlan.ts` 不再通过 report-language regex、对白 `includes` 或上游文案匹配来改写/拦截 prompt
- [x] 前端 canvas plan 执行层回到纯结构校验：schema / 时长 / 资产 / traceability / handle / URL
- [x] README / 测试 /回归已同步

## 验收

- [x] `pnpm --filter ./apps/hono-api exec vitest run src/modules/task/public-chat-delivery-verifier.test.ts src/modules/task/task.agents-bridge.prompt-specialists.test.ts`
- [x] `pnpm --filter ./apps/hono-api build`
