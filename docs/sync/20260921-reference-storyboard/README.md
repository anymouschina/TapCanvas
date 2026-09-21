# 参考图与设计板改动同步验收

来源：`TapCanvas-pro`；目标：`TapCanvas`。仅同步当前任务可复用的改动，未同步 new-api 的其他任务改动、数据库、项目资产或运行配置。没有执行 Git 提交或部署远端环境。

## 已同步

- 参考资产 Skill 开放模型调用，使用当前工具 schema，独立资产增量提交与并发，核对完整清单。
- 新增设计板图片 Skill 及三个引用文件，创建节点不再等同于出图；保留真实视觉依赖和已受理任务身份。
- API Skill 更正单节点 submission 边界，保留目标特有的其他段落。
- 设计板菜单明确“拆分并生成设计板图片”，配套修改目标现有交互测试。
- README 同步目标当前架构。目标 dispatchIntent 已明确要求真实图片，保留现有实现。

## 不适用的源补丁

目标已硬切换 DSH Harness，没有源仓库的 core/agent-loop、TaskStore、Skill 检索候选回执或专用 atomic delivery reviewer。源补丁中的 declaredRequiredSkills 修复、历史工具证据重建、任务上下文边界、账本证据内容寻址、JSON 键序比较和 reviewer token cap 不能直接复制为可运行代码。本次不恢复被移除的运行时、不创建兼容双轨，也不将目标已有状态修复冒充本次新增。

## 验证范围

- 在目标目录执行 agents TypeScript 编译、完整 Harness 测试和 SDK profile 握手。
- 在目标目录执行 dispatchIntent / IntentActionGroup 测试与 Web 生产构建。
- manifest.json 回读核验源/目标 SHA-256；API Skill 仅合并本次段落，其他同步文件逐字一致。
- 此验证不包含新一轮付费生成或批量出图端到端验收；不能从单元测试推出实际媒体交付已完成。

测试输出位于 /tmp/tapcanvas-target-harness-tests.log、/tmp/tapcanvas-target-web-tests-final.log、/tmp/tapcanvas-target-web-build.log。目标代码图按 AGENTS.md 要求运行 graphify update .。

最终结果：Harness 46/46、Web 15/15 测试通过；TypeScript 编译、SDK 握手、Web 生产构建均成功，构建产物包含新菜单文案。代码图更新成功（79 个非代码/空 AST 文件无节点的诊断保留）。
