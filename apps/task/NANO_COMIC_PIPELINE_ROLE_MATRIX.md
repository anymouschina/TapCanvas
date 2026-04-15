# 纳米漫剧流水线角色权限矩阵

目标：先把“谁能看、谁能改、谁能审、谁能发起生产”定死，避免 UI 和数据库做完后再返工权限体系。

相关文档：

- [Checklist](./NANO_COMIC_PIPELINE_CHECKLIST.md)
- [Sitemap](./NANO_COMIC_PIPELINE_SITEMAP.md)
- [DB Draft](./NANO_COMIC_PIPELINE_DB_DRAFT.md)
- [Review Flow](./NANO_COMIC_PIPELINE_REVIEW_FLOW.md)

## 1. 角色定义

首版建议只保留 6 个业务角色，不要过度细分。

### 1.1 `owner`

作用：团队拥有者，负责账号、额度、最高权限。

### 1.2 `director`

作用：创作总负责人，负责项目方向、审核通过、最终创意决策。

### 1.3 `producer`

作用：流程推动者，负责任务分配、进度推进、返工协调。

### 1.4 `artist`

作用：资产与镜头生产执行者，负责角色、场景、分镜、镜头修改。

### 1.5 `editor`

作用：视频阶段执行者，负责片段生成、合成、节奏调整。

### 1.6 `reviewer`

作用：质量审核者，负责资产、分镜、视频的质量审查。

## 2. 权限设计原则

- `owner` 管系统，不替代业务角色
- `director` 有最终审核权，但不必承担所有执行
- `producer` 能推动流转，但不能越权通过创意审核
- `artist` 和 `editor` 能修改内容，但不能直接改权限
- `reviewer` 能驳回，但不应能修改原始内容
- 默认先用 `项目级权限 + 角色权限`，不要一开始做复杂 ACL

## 3. 资源域

权限判断按 5 类资源域展开：

1. 团队与系统
2. 项目与剧集
3. 资产
4. 分镜与视频
5. 审核与协作

## 4. 权限矩阵

### 4.1 团队与系统

| 权限 | owner | director | producer | artist | editor | reviewer |
|---|---|---|---|---|---|---|
| 查看团队成员 | Y | Y | Y | Y | Y | Y |
| 邀请成员 | Y | N | Y | N | N | N |
| 修改成员角色 | Y | N | N | N | N | N |
| 查看团队额度 | Y | Y | Y | N | N | N |
| 充值/调整额度 | Y | N | N | N | N | N |
| 查看系统诊断 | Y | Y | Y | N | N | Y |

### 4.2 项目与剧集

| 权限 | owner | director | producer | artist | editor | reviewer |
|---|---|---|---|---|---|---|
| 创建项目 | Y | Y | Y | N | N | N |
| 编辑项目设置 | Y | Y | Y | N | N | N |
| 归档项目 | Y | Y | N | N | N | N |
| 创建剧集 | Y | Y | Y | N | N | N |
| 编辑剧集元信息 | Y | Y | Y | N | N | N |
| 查看所有剧集 | Y | Y | Y | Y | Y | Y |
| 指派剧集负责人 | Y | Y | Y | N | N | N |

### 4.3 资产

| 权限 | owner | director | producer | artist | editor | reviewer |
|---|---|---|---|---|---|---|
| 查看资产 | Y | Y | Y | Y | Y | Y |
| 创建资产 | Y | Y | Y | Y | N | N |
| 编辑资产 | Y | Y | N | Y | N | N |
| 新建资产版本 | Y | Y | N | Y | N | N |
| 标记资产失效 | Y | Y | Y | N | N | N |
| 提交资产审核 | Y | Y | Y | Y | N | N |
| 通过资产审核 | Y | Y | N | N | N | Y |
| 驳回资产审核 | Y | Y | N | N | N | Y |
| 跨项目复用资产 | Y | Y | Y | N | N | N |

### 4.4 分镜与镜头

| 权限 | owner | director | producer | artist | editor | reviewer |
|---|---|---|---|---|---|---|
| 查看分镜 | Y | Y | Y | Y | Y | Y |
| 生成分镜 | Y | Y | Y | Y | N | N |
| 编辑镜头说明 | Y | Y | N | Y | N | N |
| 重绘镜头 | Y | Y | N | Y | N | N |
| 选择候选镜头 | Y | Y | N | Y | N | N |
| 批量重跑受影响镜头 | Y | Y | Y | N | N | N |
| 提交分镜审核 | Y | Y | Y | Y | N | N |
| 通过分镜审核 | Y | Y | N | N | N | Y |
| 驳回分镜审核 | Y | Y | N | N | N | Y |
| 标记导演确认 | Y | Y | Y | N | N | Y |

### 4.5 视频与成片

| 权限 | owner | director | producer | artist | editor | reviewer |
|---|---|---|---|---|---|---|
| 查看视频片段 | Y | Y | Y | Y | Y | Y |
| 生成视频片段 | Y | Y | Y | N | Y | N |
| 编辑视频参数 | Y | Y | N | N | Y | N |
| 重生成视频片段 | Y | Y | N | N | Y | N |
| 提交视频审核 | Y | Y | Y | N | Y | N |
| 通过视频审核 | Y | Y | N | N | N | Y |
| 驳回视频审核 | Y | Y | N | N | N | Y |
| 导出成片 | Y | Y | Y | N | Y | N |

### 4.6 审核、评论、协作

| 权限 | owner | director | producer | artist | editor | reviewer |
|---|---|---|---|---|---|---|
| 查看评论 | Y | Y | Y | Y | Y | Y |
| 发表评论 | Y | Y | Y | Y | Y | Y |
| @成员 | Y | Y | Y | Y | Y | Y |
| 指派返工任务 | Y | Y | Y | N | N | N |
| 修改返工优先级 | Y | Y | Y | N | N | N |
| 关闭返工任务 | Y | Y | Y | N | N | N |
| 查看审核历史 | Y | Y | Y | Y | Y | Y |
| 删除评论 | Y | Y | N | N | N | N |

## 5. 关键规则

### 5.1 `producer` 不能替代创意审核

`producer` 可以：

- 指派
- 催办
- 重新排期
- 触发批量执行

`producer` 不可以：

- 直接通过导演级审核
- 修改角色最终设定
- 跳过关键审核节点

### 5.2 `reviewer` 不能直接改内容

`reviewer` 只做：

- 通过
- 驳回
- 填驳回原因
- 标记风险

`reviewer` 不做：

- 直接改镜头
- 直接改角色设定
- 直接改视频参数

### 5.3 `director` 保留最终创意裁决权

以下事项建议必须允许 `director` 最终确认：

- 角色基准形象
- 项目总风格
- 关键分镜
- 最终成片

## 6. 项目级附加权限

除全局角色外，项目内可追加项目角色：

- `project_owner`
- `episode_owner`
- `asset_owner`

作用：

- 只在当前项目或剧集生效
- 用于小团队细化责任归属
- 不改变团队级基础角色

## 7. UI 映射建议

### 7.1 导航控制

- 无权限时不展示入口，不只是点进去报错
- `artist` 默认不显示团队额度
- `reviewer` 默认突出审核中心
- `editor` 默认突出视频工作台

### 7.2 操作按钮控制

常见按钮需要按角色控制：

- `提交审核`
- `通过`
- `驳回`
- `指派`
- `批量重跑`
- `导出`
- `归档`

### 7.3 只读态

以下页面在只读场景下必须明确展示：

- 当前用户角色
- 当前页面只读原因
- 允许执行的下一步操作

## 8. 数据库映射建议

建议落在：

- `team_memberships.role`
- `projects.owner_user_id`
- `episodes.owner_user_id` 或独立负责人表
- `assignments`
- `approval_steps.role_required`

首版不建议：

- 做复杂的资源级 ACL 表
- 做表达式权限系统
- 做可视化权限编排器

## 9. 首版最小权限集

如果你要再收敛一层，首版可以只保留 4 个角色：

- `owner`
- `director`
- `artist`
- `reviewer`

`producer` 与 `editor` 暂时用业务约定或次级职责承接。

## 10. 下一步

建议下一步继续补：

1. `owner/director/artist/reviewer` 的首版最小权限版
2. 项目级负责人模型
3. 权限校验失败错误码约定

