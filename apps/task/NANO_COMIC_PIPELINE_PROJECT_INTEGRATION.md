# 纳米漫剧流水线项目内接入方案

目标：明确这套能力如何接到当前 TapCanvas 项目壳里，避免后续 UI 走偏成一个平行系统。

相关文档：

- [Sitemap](./NANO_COMIC_PIPELINE_SITEMAP.md)
- [Component Split](./NANO_COMIC_PIPELINE_COMPONENT_SPLIT.md)
- [Workspace ASCII](./NANO_COMIC_PIPELINE_WORKSPACE_ASCII.md)
- [Canvas Integration](./NANO_COMIC_PIPELINE_CANVAS_INTEGRATION.md)

## 1. 第一性结论

这套漫剧流水线不该作为一个独立系统入口存在。

原因很简单：

1. 当前仓库已经有稳定的项目上下文机制 `currentProject`
2. 主生产面已经是 `CanvasApp`
3. 资产、分镜、任务节点本来就和画布强耦合

如果再单独造一个“漫剧系统首页”，会直接带来三套上下文：

- 项目上下文
- 漫剧工作台上下文
- 画布上下文

这会让交互和数据流都变脏。

## 2. 推荐入口

### 2.1 入口顺序

```text
/projects
  -> 用户选择项目
  -> 系统设置 currentProject
  -> 返回 CanvasApp
  -> FloatingNav 打开“漫剧工作台”
```

### 2.2 入口层级

- 一级入口：`/projects`
- 项目内入口：`FloatingNav`
- 项目内工作区：`NanoComicWorkspaceHost`

### 2.3 不建议的做法

- 不新增独立 `/nano-comic` 首页
- 不新增脱离 `currentProject` 的第二套项目选择器
- 不把漫剧工作台做成和画布平行的另一个主应用壳

## 3. 当前页打开原则

项目内工作台首版应在当前页打开，不跳新页面。

建议表现形式：

- 右侧大工作区
- 居中扩展工作区
- 或覆盖式 workspace layer

但无论哪种形式，都必须满足：

- 打开工作台时保留当前画布状态
- 关闭工作台时回到原画布位置
- 工作台和画布共享同一个 `currentProject`

## 4. 首版工作台范围

首版只做三个页签最合理：

- `概览`
- `分镜`
- `审核`

原因：

- `概览` 负责项目级总控
- `分镜` 是核心生产面
- `审核` 负责交付收口

`资产库`、`视频`、`团队` 可以后续补，不必一开始就把壳铺太大。

## 5. 与现有能力的复用关系

### 5.1 继续复用

- 项目选择
- 当前项目状态
- 画布节点体系
- 资产面板里的项目资产与角色卡逻辑
- 运行记录与执行状态

### 5.2 新增承接层

- `NanoComicWorkspaceHost`
- `ProjectOverviewPage`
- `ShotWorkspacePage`
- `ReviewCenterPage`

### 5.3 明确职责边界

- `CanvasApp`
  - 负责全局画布与项目上下文
- `漫剧工作台`
  - 负责项目内生产与审核视图
- `画布`
  - 负责承接最终产物、过程节点和返工节点

## 6. 关键交互结论

### 6.1 从工作台到画布

每个关键产物都应该支持：

- `加入画布`
- `定位到画布`
- `如果已在画布中，则显示已关联`

### 6.2 从画布回工作台

画布中的相关节点也应该能反查：

- 来自哪个项目
- 来自哪个章节/镜头/审核对象
- 一键打开对应工作台详情

## 7. MVP 落地建议

第一阶段不要碰数据库和智能体编排，只做：

1. `FloatingNav` 新入口
2. 当前页内工作台宿主
3. 三个静态页签
4. mock 数据
5. `加入画布` 的前端交互壳

先把结构跑通，再接真实数据。
