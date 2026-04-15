# 纳米漫剧流水线产物入画布清单

目标：明确哪些产物要进入画布、进入后是什么节点、由谁触发，避免后面每个模块都各自发明“落画布”方式。

相关文档：

- [Project Integration](./NANO_COMIC_PIPELINE_PROJECT_INTEGRATION.md)
- [Workspace ASCII](./NANO_COMIC_PIPELINE_WORKSPACE_ASCII.md)
- [Checklist](./NANO_COMIC_PIPELINE_CHECKLIST.md)

## 1. 第一性原则

画布不是附件区，而是项目内生产结果和返工任务的最终承接面。

因此：

- 重要产物要能进入画布
- 进入画布后要保留来源关系
- 不能在漫剧工作台里维护一套平行“已产出结果系统”

## 2. 入画布的两类方式

### 2.1 主动加入

用户在工作台中点击：

- `加入画布`
- `批量加入画布`

### 2.2 被动生成

系统在关键流程完成后直接创建节点：

- 章节分镜生成中
- 章节分镜生成完成
- 驳回返工任务创建
- 审核意见节点创建

## 3. 产物映射表

| 产物类型 | 工作台来源 | 进入画布后的建议形态 | 说明 |
| --- | --- | --- | --- |
| 角色卡 | 资产/分镜 | `taskNode(kind=image)` | 保留 `roleName`、`cardId`、`sourceProjectId` |
| 场景参考 | 资产/分镜 | `taskNode(kind=image)` | 保留 `locationId`、空间锚点摘要 |
| 道具参考 | 资产/分镜 | `taskNode(kind=image)` | 保留 `propId`、固定道具标签 |
| 风格设定 | 概览/资产 | `taskNode(kind=text or image)` | 作为提示词和视觉锁说明 |
| 镜头分镜图 | 分镜 | `taskNode(kind=image)` | 保留 `episodeId`、`shotId`、`candidateId` |
| 镜头候选结果 | 分镜 | `taskNode(kind=image)` | 允许多候选分别入画布 |
| 分镜脚本摘要 | 分镜 | `taskNode(kind=text)` | 作为镜头上下文节点 |
| 视频片段 | 分镜/审核 | `taskNode(kind=video)` | 保留 `segmentId`、上游镜头来源 |
| 审核意见 | 审核 | `taskNode(kind=text)` | 形成返工说明或审核记录 |
| 返工任务 | 审核 | `taskNode(kind=text)` | 明确阻塞原因与责任人 |
| 章节分组 | 分镜 | `groupNode + children` | 用于把同一章节镜头聚合显示 |

## 4. 首版必须支持的入画布对象

MVP 先只做这些：

1. 角色卡
2. 场景参考
3. 镜头分镜图
4. 镜头候选结果
5. 视频片段
6. 审核返工节点

其他对象先不急。

## 5. 每类对象的最小字段

### 5.1 视觉产物

至少带：

- `projectId`
- `episodeId`
- `shotId`
- `assetId` 或 `candidateId`
- `imageUrl` 或 `videoUrl`
- `sourceType`
- `sourceLabel`

### 5.2 文本类任务节点

至少带：

- `projectId`
- `episodeId`
- `shotId`
- `reviewId` 或 `taskId`
- `summary`
- `sourceType`
- `status`

## 6. 节点动作要求

每个已落画布的产物节点，至少支持：

- `打开来源`
- `重新定位到工作台`
- `查看项目/剧集/镜头`
- `查看当前状态`

如果是审核或返工节点，还应支持：

- `标记已处理`
- `跳转到审核详情`

## 7. 工作台内按钮规范

### 7.1 单对象

- `预览`
- `加入画布`
- `定位画布`

### 7.2 列表批量

- `批量加入画布`
- `仅加入高风险`
- `仅加入已通过`

## 8. 冲突处理原则

当同一产物已经在画布中存在时：

- 不要静默重复创建
- 明确提示 `已在画布中`
- 默认提供 `定位已有节点`
- 如用户明确要求，才允许 `再次创建副本`

## 9. 反向联动

画布节点需要能反查来源。

建议所有节点都保留：

- `sourceProjectId`
- `sourceEpisodeId`
- `sourceShotId`
- `sourceEntityType`
- `sourceEntityId`

这样才能从画布一键回到工作台详情。

## 10. 首版落地优先级

### P0

- 角色卡加入画布
- 分镜图加入画布
- 视频片段加入画布
- 驳回返工节点加入画布

### P1

- 批量加入画布
- 从画布定位回工作台
- 避免重复创建相同节点

### P2

- 章节级 groupNode 自动整理
- 审核批量生成返工节点
- 画布与工作台双向高亮
