# Chapter Grounded Trace Optimization Checklist

目标：修复 chapter-grounded 图片节点在同轮修复时被重复计数、结构化提示词契约不一致、以及 team 子代理等待放大耗时的问题，避免 trace 进入长时间错误重试链。

## 1. 节点最终态聚合

- [x] `agents-cli` completion verifier 不再按 `tapcanvas_flow_patch` 的每次 create/patch 累加目标节点
- [x] 同一轮内按 `nodeId` 聚合最终节点状态
- [x] `patchNodeData` 未显式带 `kind` 时，优先继承同轮已知节点 `kind`
- [x] 仅在无法推断 `kind` 时才保持保守失败

## 2. 结构化提示词契约统一

- [x] completion verifier 同时接受 `structuredPrompt` 与遗留 `imagePromptSpecV2`
- [x] bridge diagnostics 与 verifier 使用同一套 v2 schema 判断
- [x] 对 legacy object-shape 的处理保持一致，不再出现 web 能编译、verifier 却判非法的分裂

## 3. Bridge 诊断修正

- [x] `apps/hono-api` 中 chapter-grounded image prompt governance 改为基于最终节点状态统计
- [x] 同一节点先 create 再 patch 修正时，最终状态有效则不再继续报 missing/invalid
- [x] patch-only 修正路径不再因为缺少 `kind` 而被统计器忽略

## 4. 回归测试

- [x] 为 completion verifier 补“先 create 再 patch 修正同一节点”测试
- [x] 为 completion verifier 补 `structuredPrompt` 生效测试
- [x] 为 bridge diagnostics 补“同轮最终态修复后不再报错”测试

## 5. 文档同步

- [x] 更新 `apps/hono-api/README.md` 的 AI 对话架构章节，记录最终态聚合与 structuredPrompt / legacy alias 兼容规则

## 6. 验证

- [x] 运行相关单测
- [x] 复核本次改动是否直接针对 trace 中的三类主因，而不是新增绕路逻辑

## 验证记录

- [x] `pnpm --filter agents build`
- [x] `node --test apps/agents-cli/dist/core/completion/deterministic-completion-verifier.test.js`
- [x] `pnpm --filter @tapcanvas/api test -- apps/hono-api/src/modules/task/task.agents-bridge.prompt-specialists.test.ts`
- [x] `pnpm --filter @tapcanvas/api build`

## 收口结论

- 本次修复的核心是让 verifier 与 bridge 都基于“同轮最终节点状态”做判断，并统一 `structuredPrompt` / `imagePromptSpecV2` 的契约识别。
- trace 的长耗时主因是错误地把同一节点的多次 create/patch 当成多个失败目标，导致反复补写、重复自检和 team wait 被放大；本次改动直接切断了这条错误重试链，没有新增本地语义兜底或绕路逻辑。
