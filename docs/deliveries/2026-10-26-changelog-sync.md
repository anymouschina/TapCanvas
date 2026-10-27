# 2026-10-26 应用内更新日志同步

## 来源与范围

本轮选择 `TODO.md` 的 F13，从同级 `TapCanvas-pro` 工作区同步轻量的日志弹窗，适配社区版 `PortalHeader` 顶部入口。源码核对时来源 HEAD 为 `5999e55d004b59e348c05d67a6631bb44685514a`；读取的来源文件为 `apps/web/src/portal/changelog/ChangelogDialog.tsx`、`ChangelogDialog.css`、`entries.ts`，并参考 `PortalSideNav.tsx` / `PortalSideNav.css` 中的入口实现。来源工作区的故事线未提交修改不在本轮范围。

这项功能只涉及前端展示，不依赖 Pro Agent 内核、商业计费、数据库变更或媒体生成。社区版继续使用现有 DSH Harness。没有复制来源环境文件、凭据、用户数据或部署资料。

## 社区版行为与维护

- 在门户顶部点击「更新日志」图标打开弹窗，按日期查看社区版已实现功能，支持关闭后重新打开；入口保留可访问名称。
- 首次查看或本地已读 ID 与最新条目不同，显示未读标记；弹窗内容成功挂载后在 `localStorage` 的 `tapcanvas.community.changelog.read` 记录最新条目 ID。该状态属于当前浏览器，不同步到账号。
- 读写失败在弹窗中显示具体原因并记录日志，不声称已保存或已知未读状态；关闭始终可用，重开可再次尝试记录。
- 日志内容区域支持滚动，保留标准弹窗关闭交互。
- 将 Pro 的工作台 API、生产部署记录替换为本仓库 README 与交付记录可追溯的社区版更新；源码实现不代表已部署或完成真实生成验收。
- 来源实现只有手动打开与关闭；已读持久化是本轮根据 F13 清单补全的确定性交互。不自动弹出，也不新增版本更新服务。

后续维护入口为 `apps/web/src/portal/changelog/entries.ts`。新增条目时使用独立 `id` 并置于数组首位，让已有浏览器显示新内容提示，同时同步根目录中英文 README；内容应描述社区版实际实现与验证边界，不直接复制 Pro 发布记录。日志数据仅用于界面展示，不作为 Agent 运行时知识输入。

## 验证边界

- 定向交互测试：`NODE_OPTIONS=--no-experimental-webstorage pnpm --filter @tapcanvas/web exec vitest run --config _test/vitest.config.ts src/portal/changelog/ChangelogLauncher.test.tsx`，1 个文件、3 项通过。覆盖首次手动打开、内容展示、关闭重开、重挂后的已读状态、新版本提示，以及存储拒绝时的错误展示、关闭和恢复后重试。
- `pnpm --filter @tapcanvas/web exec tsc --noEmit`：零错误。
- `git diff --check` 通过；中英文 README 的可见更新各 10 条、折叠历史各 11 条已核对。
- 已按仓库规范尝试 `graphify update .`；当前环境没有 `graphify` 命令（退出码 127），知识图未更新。

本机 Node v26.11.1 的实验 Web Storage 会影响 jsdom，定向测试仅在测试进程关闭该实验功能，使用 jsdom 的真实 Storage，没有改写产品存储行为。

这些结果是本地组件交互与类型检查，不代表已部署或浏览器端到端验收。没有部署社区版服务、操作真实用户画布或提交模型生成任务。
