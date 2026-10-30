# 2026-10-30 项目画布保存协调（F10）

## 来源与范围

按用户选择，从同级 TapCanvas-pro 借鉴 `createCanvasSaveCoordinator.ts`、`createCanvasAutosaveScheduler.ts`（逻辑原样）、协调器单测，以及 `App.tsx` 的接线方式。读取来源时 Pro HEAD 为 `313af46300c4b8f938225d4b3cc9aaff148cf7c6`。保留社区版 DSH、`saveWithConflictRebase`、本地 `flowConflictRebase`、画布成员关系保存与 `persistCodexCanvasBeforeDispatch`；不迁入 Pro 的 `canvasMutation.ts`（依赖内核协议）、改走 `@tapcanvas/workflow-kernel-protocol` 的 rebase、章节画布保存确认或新建项目后的延迟跳转。

## 行为变化

- 自动保存、手动「保存」、`window.silentSaveProject`（AI 对话派发、Codex 任务、运行器、画布分组触发、`saveCurrentCanvasSnapshot` 等调用方）在同一画布会话内走同一条串行队列，不再并发发出多个整图保存。
- 调用方等到「它发起请求时的修订」已落盘才返回；保存期间产生的新编辑，会在释放队列前再保存一轮，不必等下一次触发。切换路由后旧会话的保存不会对新画布继续执行。
- 自动保存改由调度器驱动：每次内容修订（画布订阅、创作进度变化）请求一次，静默 800 毫秒后保存；`isDirty` 变真时同样请求一次，覆盖不经过画布订阅的导入路径。原先依赖 `isDirty`、`saving` 与每次渲染都会变的 `silentSave` 引用来重启定时器，保存期间再编辑时 `isDirty` 不变，是否补存取决于 App 恰好重新渲染。
- `window.silentSaveProject` 的函数身份固定，始终调用最新渲染的保存闭包；此前每次 `saving`、`currentFlow`、`currentProject` 变化都会重新注册。
- 「保存」按钮的加载状态只反映手动保存，不会被后台自动保存点亮。

## 与来源的差异（未同步）

- 章节画布：Pro 的 `ensureChapterCanvasSaved` 依赖其编辑序号体系，未迁。社区版章节画布保持现有 `flushForCodex`。
- `persistCanvasBeforeSubmission` 的「有 flow 即强制保存」未迁。社区版画布订阅没有排除 `remoteApplyGuard`，远端导入的节点同样递增修订并标脏，所以继续按脏标记决定提交前是否保存。这是对代码的阅读结论，未在运行中复现。
- 保存失败后不再因无关渲染隐式重试：保持 `isDirty`，等待下一次编辑或手动保存。
- 新建项目的首次保存仍立即 `spaReplace`，未迁 Pro 的延迟跳转。该次保存期间的新编辑因路由切换会话失效而不补存，与改动前一致。
- 协作同步状态徽章（`CanvasSyncStatusBadge`）未迁。它依赖 Pro 重写后的补丁广播链路（服务端确认后才推进基线、失败可重试），而社区版 `useCanvasSync` 在发送时即推进基线并忽略失败；这是协作广播的独立改造，不属于「避免服务端读到旧画布」。

## 已知取舍

- 若持续编辑（例如长时间拖动）恰好在一次保存进行中开始，协调器会在每次保存完成后立即再存一轮，直到修订不再变化，可能比改动前产生更多画布版本。Pro 的协调器有相同行为。未量化。
- 手动保存若恰好并入一次进行中的自动保存，由自动保存路径执行：没有「保存中 / 已保存」提示，也不经过 `filterNodesForPersistence`。自动保存路径原本就不做该过滤。

## 验证

- 协调器、调度器和协调器单测与 Pro 对应文件逐字节一致（`cmp` 核对）。
- `apps/web/src/canvas/persistence` 7 个文件 38 项测试通过，其中新增 `createCanvasAutosaveScheduler.test.ts` 8 项：防抖合并、三种不可保存原因的跳过上报、保存抛错上报、销毁后不再保存，以及调度器与协调器联动（保存中再编辑无需额外触发即补存；显式保存与自动保存重叠时同一时刻只有一个保存）。临时绕过协调器后，联动的两项会失败，其余 6 项仍通过，随后已删除该临时文件。
- Web 全量 `tsc --noEmit` 通过。
- Web 全量 vitest（Node v26.11.1，需 `NODE_OPTIONS=--localstorage-file=<路径>`，否则 Node 内置实验性 `localStorage` 与 jsdom 冲突，导致 `chatSessionTitle` 等用例报 `reading 'clear'`）：398 个文件通过、4 个失败；1953 项通过、6 项失败、1 项跳过。失败为 `AddNodePanel.test.tsx`（1）、`editableImageSource.test.ts`（1）、`ChangelogLauncher.test.tsx`（1）、`imageUrlTransform.test.ts`（3）。在暂存本次全部改动的基线上、同样环境参数下单独运行这 4 个文件，得到相同的 6 项失败，因此不是本次改动引入。未调查其根因；`ChangelogLauncher` 那项测试的是存储被阻止的场景，可能与上述 `--localstorage-file` 参数有关，未核实。
- `git diff --check` 通过。按根 AGENTS 要求尝试 `graphify update .`，命令未安装（退出码 127），图索引未更新。
- **未做浏览器验证**：本机没有运行中的开发服务，`App.tsx` 的接线（协调器、调度器、`silentSaveProject` 注册）没有在真实页面里跑过，也没有对着真实 API 做保存。目前只有类型检查、协调器/调度器单测，以及对 diff 和调用方的代码阅读。
- 未部署线上服务，未提交模型请求。
