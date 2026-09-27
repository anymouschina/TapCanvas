# 一键成片 v114 同步

来源为同级 `TapCanvas-pro` 工作区：已提交 HEAD `6ab53d1fd1`，加上该工作区尚未提交的 v114 画布定义及其结构化修订策略。Pro 的本地 `flowGet` 快照记录 v114、指纹 `sha256:e1ef5f3fa343c832b4d0bbb8e0ac1bc8fffa407dca32e40abf3a777c36a6cb74`、15 个节点和 30 条边。该快照只证明本地工作流已装配，不证明 Pro 生产环境已升级。

本仓库保留 DeepSeek Harness Bridge，按 v114 定义同步共享协议、编辑器工作流、逐 Clip 执行器、预制媒体节点与相关运行时 Skill。`full_video` 从冻结章节来源分段，编制章级资产和逐 Clip 生产包；每个 Clip 先持久化视频节点，再按共享图片身份准备真实依赖。`onlyVideoNodes` 在媒体阶段仅准备并验证节点、提示词、引用及所需图片 URL，不提交视频供应商或合成。生成成功的资产与失败证据继续保留。

系统发布使用新身份 `tapcanvas.builtin.video-production/v114` 和独立不可变 Flow 版本；历史 v90 发布 SQL 与已保存执行不被覆盖。发布图从 Web 纯定义导出，发布 SQL 从图生成；这两步只写仓库文件，不连接数据库，也不部署服务。

## 验证

- Pro v114 模板：10 项测试通过，包含 canonical fingerprint。
- `node scripts/export-system-video-workflow.mjs --check`：v114 图 15 节点、30 条边，与编辑器定义一致。
- `system-video-production-workflow.test.ts`：2 项通过，包含图编译与发布 SQL 一致性。
- 共享来源、Clip 生产包、分段与生成引用合同：31 项测试通过；同步时修正了 Pro 中已落后于 v114 schema 的 Clip 测试夹具，未放宽校验器。
- Web 工作流、媒体恢复及能力舱：103 项定向测试通过，1 项手动导出测试按原设计跳过；Vite production build 成功。
- 能力舱后端受理与描述符：84 项定向测试通过；画布 API Skill 的装配工作流启动脚本：3 项测试通过。

未操作 Pro 或本仓库的真实用户画布、生产数据库及媒体供应商；代码测试不能替代付费成片验收。
