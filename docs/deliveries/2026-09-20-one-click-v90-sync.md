# 一键成片 v90 同步与 DSH 适配

来源：`/Volumes/ZHITAI-System/UserData-libiqiang-20260913/workspace/TapCanvas-pro` 的当前工作区，包含其未提交的最新版改动；源 HEAD 为 `0129df801`。本次仅迁移一键成片及其必要依赖，没有整体替换项目。

## 交付

- Workflow IR v90：章节剧情规划、共享资产规划、逐 Clip 视觉设计、资产引用登记、逐段 writer、媒体生成与交付；保留 `onlyVideoNodes` 分支。
- 保留当前 DeepSeek Harness 运行时和统一聊天入口。补齐机器意图合同记录与 hash 冻结、结构化输出提交、同轮结构修复与基于真实工具证据的交付验收，没有恢复旧 agent loop。
- 异步回执明确由 durable executor 接管时，仅结束提交交接，媒体仍 pending；不创建第二条对话 continuation。
- 不完整媒体覆盖显式失败，保留成功资产与 outputRefs；旧成功回执不能覆盖同一 execution 后来的失败或取消事实。
- 补齐画布删除/恢复账本在前端推送、保存接口、后端路由及重载之间的传递，避免已移除执行卡重新出现。
- 从编辑器纯定义生成系统工作流：31 节点、51 条边。使用独立、不可变发布身份，保留现有按字长拆分视频节点操作。

## 主要入口

- 纯工作流定义：`apps/web/src/canvas/videoWorkflowDefinition.ts`
- DSH 协议适配：`apps/agents-cli/src/bridge/structured-output.ts`、`artifact-delivery-report.ts`、`tool-delivery-evidence.ts`
- 系统发布：`apps/hono-api/src/modules/agents/system-video-production-workflow.ts`
- 发布 SQL：`apps/hono-api/sql/releases/20260920_video_production_v90.sql`
- 架构说明：`apps/hono-api/README.md` 的“AI 对话架构（当前）”

## 验证记录

- 编辑器定义与后端生成图一致性：`node scripts/export-system-video-workflow.mjs --check` 通过。
- 发布定义、原拆分工作流和能力 schema：47 项通过。
- DSH build 与完整 bridge 测试通过，新增意图合同测试通过。
- 前端相关回归：162 项通过；最终生产构建通过。完整 Web 类型扫描剩余 10 条未修改文件中的诊断，本次同步/新增文件为 0 条。
- 后端最终回归：97 个测试文件、1031 项通过，1 项手动测试跳过；最后测试 hook 修复另有 36 项定向测试通过。视频链回归 1251 项通过，1 项超时定向重跑通过；各集合存在重叠，不累加统计。
- API 正式构建通过，ReferenceError 门禁为 0。完整 TypeScript 检查的最后构建记录仍有 160 项诊断：新增文件 0、修改文件 8、其他文件 152；其中测试 hook 一项随后已修。其余诊断尚未全部消除，不能宣称全库类型检查通过，也不将其全部归为历史问题。
- 共享 schema 使用的既有 `zod@3.25.76` 补为根工作区直接依赖，锁文件未升级其他依赖。

未执行部署、数据库迁移或真实付费成片测试。发布 SQL 是可审阅产物；API 下次部署启动会按现有系统工作流发布机制追加 v90 定义，已有执行仍保留原冻结版本。
