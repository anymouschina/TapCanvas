# 纳米漫剧流水线会话续接记录

更新时间：2026-03-23

目标：把当前已经落地的代码、已确认的产品决策、未完成的下一步记录清楚，方便下次会话直接继续，不再重复分析。

## 1. 已确认的产品方向

这条线已经定了，不要再反复摇摆：

- 不做独立的“漫剧系统首页”
- 保持现有 TapCanvas 模型：先选项目，再在当前项目内工作
- 主入口还是 `/projects`
- 进入项目后，在当前 `CanvasApp` 页面内打开“漫剧工作台”
- 工作台不是替代画布，而是压在画布上的项目工作层
- 关键产物必须支持 `加入画布 / 定位画布`

相关方案文档：

- [NANO_COMIC_PIPELINE_PROJECT_INTEGRATION.md](./NANO_COMIC_PIPELINE_PROJECT_INTEGRATION.md)
- [NANO_COMIC_PIPELINE_WORKSPACE_ASCII.md](./NANO_COMIC_PIPELINE_WORKSPACE_ASCII.md)
- [NANO_COMIC_PIPELINE_CANVAS_INTEGRATION.md](./NANO_COMIC_PIPELINE_CANVAS_INTEGRATION.md)

## 2. 已落地的代码

### 2.1 入口与宿主

已经完成：

- `FloatingNav` 新增 `漫剧工作台` 入口
- `uiStore` 新增 `activePanel = 'nanoComic'`
- `App.tsx` 已挂载 `NanoComicWorkspacePanel`

涉及文件：

- [`apps/web/src/ui/FloatingNav.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/ui/FloatingNav.tsx)
- [`apps/web/src/ui/uiStore.ts`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/ui/uiStore.ts)
- [`apps/web/src/App.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/App.tsx)
- [`apps/web/src/ui/NanoComicWorkspacePanel.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/ui/NanoComicWorkspacePanel.tsx)

### 2.2 工作台结构

已经完成：

- 当前页覆盖式工作台 UI
- 三个页签：
  - `概览`
  - `分镜`
  - `审核`

涉及文件：

- [`apps/web/src/ui/nanoComic/NanoComicOverviewTab.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/ui/nanoComic/NanoComicOverviewTab.tsx)
- [`apps/web/src/ui/nanoComic/NanoComicStoryboardTab.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/ui/nanoComic/NanoComicStoryboardTab.tsx)
- [`apps/web/src/ui/nanoComic/NanoComicReviewTab.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/ui/nanoComic/NanoComicReviewTab.tsx)
- [`apps/web/src/styles.css`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/styles.css)

### 2.3 数据接入现状

已经完成：

- 工作台不再只是纯 mock
- 已开始读取当前 `currentProject` 的真实数据
- 已接入的数据包括：
  - 项目书列表
  - 当前书的 `ProjectBookIndexDto`
  - 分镜历史 `ProjectBookStoryboardHistoryDto`
  - 项目级角色卡资产 `ProjectRoleCardAssetDto[]`

涉及文件：

- [`apps/web/src/ui/NanoComicWorkspacePanel.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/ui/NanoComicWorkspacePanel.tsx)
- [`apps/web/src/ui/nanoComic/dataMappers.ts`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/ui/nanoComic/dataMappers.ts)
- [`apps/web/src/ui/nanoComic/types.ts`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/ui/nanoComic/types.ts)

对应复用的 API / DTO：

- [`apps/web/src/api/server.ts`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/api/server.ts)

当前已用到的接口：

- `listProjectBooks`
- `getProjectBookIndex`
- `listProjectBookStoryboardHistory`
- `listProjectRoleCardAssets`

### 2.4 画布联动

已经完成：

- 分镜与审核对象支持 `加入画布`
- 已加入对象支持 `定位画布`
- 当前会话内通过 `sourceEntityKey` 记录工作台插入的节点

限制：

- 目前“定位画布”只认本次工作台会话插入的节点
- 还没有做“从已有画布全量反查同源节点”的完整索引

主要文件：

- [`apps/web/src/ui/NanoComicWorkspacePanel.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/ui/NanoComicWorkspacePanel.tsx)

### 2.5 已有真实交互

已经完成：

- 源书选择
- 章节选择
- 工作台刷新
- `只看待处理`
- `高风险筛选`
- `打开资产库`
- 工作台到 `AssetPanel` 的精确跳转
  - `uiStore` 已增加 `assetPanelFocusRequest`
  - `NanoComicWorkspacePanel` 会按当前页签写入 `bookId / chapter / tab / materialCategory`
  - `AssetPanel` 打开后会消费该请求并切到对应小说、章节与素材分类
- 工作台独立章节分镜流水线
  - 分镜页现在有自己的“章节分镜流水线”面板
  - `继续本章分镜` / `重跑全章分镜` 已直接在 `Nano Comic Workspace` 内执行，不再转发到 `AssetPanel`
  - `groupSize` 不再被前端硬编码成全局 `25`
  - 当前工作台会优先沿用已有证据里的 `groupSize`：`storyboardPlans.groupSize -> history.progress.next.groupSize -> storyboardChunks.groupSize`
  - 仅在当前章节没有任何可用证据时，才回落到默认值 `25`
  - 执行顺序是：`plan` 生成 -> `storyboardPlans` 落盘 -> `chunk` 逐组生图 -> `storyboardChunks` 落盘 -> 结果节点落画布
  - 工作台面板会直接显示当前章节的 `计划镜头 / 已生成分组 / 下一续写范围 / 连续性尾帧`
  - 每个已产出的 chunk 都支持 `加入画布 / 定位画布`
- 工作台章节分镜执行反馈
  - `uiStore` 已增加共享的 `nanoComicStoryboardRunState`
  - `Nano Comic Workspace` 自己执行章节分镜时会把真实运行中/完成/失败状态写回 store
  - 工作台公共区会显示当前章节最近一次分镜状态，并支持 `定位最新产出`
  - 概览页章节行与分镜页镜头列表也会感知当前章节最近一次执行状态
- 分镜页空状态跳转到 `AssetPanel`
- 审核页详情跳转到 `AssetPanel`

## 3. 当前没有做的部分

这些还没做，不要误判成已完成：

- 没有接真实审核持久化模型
- `通过 / 打回 / 提交审核` 还不是正式后端操作
- 没有把视频段的真实数据接进来
- 没有做工作台和画布节点之间的双向高亮
- 没有做“根据 sourceEntityKey 扫全画布找同源节点”的持久反查

## 4. 当前已确认的流水线逻辑

这部分不要再回退成“AssetPanel 里点按钮”的产品解释：

1. 在 `Nano Comic Workspace` 选择 `project / book / chapter`
2. 通过 agents pipeline 生成当前章节的分镜计划
3. 将章节计划写入 `storyboardPlans`
4. 根据 `storyboardPlans + storyboardChunks` 计算下一组续写位置
5. 逐组调用 `runStoryboardWorkflowGenerate` 生成静态帧
6. 每组结果写入 `storyboardChunks`，并保留 `tailFrameUrl`
7. 将每组结果作为派生节点落到画布，画布只负责承接结果，不负责驱动状态机

## 5. 下一步最合理的继续方向

优先级建议已经收敛，不要再回到空泛设计：

### P1

把章节分镜执行反馈进一步和画布节点做双向高亮，而不是只展示状态文本。

目标：

- 从工作台状态能反向高亮当前 progress node / 当前 chapter group children
- 从画布章节分镜组能回到当前章节工作台
- 逐步收敛为真正的双向联动，而不是单向定位

### P2

再考虑真实审核流，而不是现在就单独发明一套。

## 6. 下次会话建议起手

下次直接按这个句子继续最省时间：

`继续做 Nano Comic 工作台里章节分镜产物和画布节点的双向索引/高亮，不再只做当前会话内的临时定位。`

## 7. 验证状态

最近一次已确认：

- `ALLOW_LOCALHOST_IN_PROD_BUILD=1 pnpm --filter @tapcanvas/web build` 通过

本次记录没有做 git commit。
