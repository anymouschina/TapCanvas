# 纳米漫剧流水线审核流转图

目标：把“提交审核 -> 通过/驳回 -> 返工 -> 再审”的流程与状态写死，避免后续 UI、数据库和智能体执行链互相打架。

相关文档：

- [Checklist](./NANO_COMIC_PIPELINE_CHECKLIST.md)
- [Sitemap](./NANO_COMIC_PIPELINE_SITEMAP.md)
- [DB Draft](./NANO_COMIC_PIPELINE_DB_DRAFT.md)
- [Role Matrix](./NANO_COMIC_PIPELINE_ROLE_MATRIX.md)

## 1. 审核对象

首版只审核三类对象：

1. 资产
2. 分镜 / 镜头
3. 视频片段 / 成片

不要首版就给所有对象都做不同流程，先统一一套审核骨架。

## 2. 审核目标

审核不是“走个流程”，而是解决三件事：

1. 内容质量是否达标
2. 是否允许进入下一生产阶段
3. 是否需要返工并记录责任与原因

## 3. 通用状态

### 3.1 审核前对象状态

- `draft`
- `ready`
- `running`
- `failed`

### 3.2 审核态

- `pending_review`
- `in_review`
- `changes_requested`
- `approved`
- `rejected`

### 3.3 返工态

- `rework_open`
- `rework_in_progress`
- `rework_done`

## 4. 通用流转

```text
draft
  -> ready
  -> submit_review
  -> pending_review
  -> in_review
    -> approved
    -> changes_requested
    -> rejected

changes_requested
  -> rework_open
  -> rework_in_progress
  -> rework_done
  -> submit_review
  -> pending_review
```

## 5. 通过、驳回、打回的区别

### 5.1 `approved`

含义：

- 当前对象质量通过
- 允许进入下一阶段
- 下游可继续生产或审核

### 5.2 `changes_requested`

含义：

- 当前对象不是完全废弃
- 需要明确修改后重新提交
- 适合轻中度问题

典型场景：

- 分镜节奏不顺
- 角色表情不稳定
- 视频运镜不理想

### 5.3 `rejected`

含义：

- 当前结果不应继续沿用
- 通常需要重新生产或回到更上游
- 适合严重问题

典型场景：

- 角色基准设定错了
- 场景空间逻辑完全错误
- 视频片段完全不可用

## 6. 审核层级建议

### 6.1 资产审核

审核项：

- 角色设定是否成立
- 场景是否统一
- 道具是否可复用
- 风格配置是否稳定

通过后：

- 可被分镜阶段正式引用

驳回后：

- 相关待生成镜头禁止继续推进

### 6.2 分镜审核

审核项：

- 是否符合剧情
- 角色是否稳定
- 场景是否穿帮
- 镜头衔接是否自然
- 是否需要导演确认

通过后：

- 进入视频阶段

驳回后：

- 回到镜头编辑或上游资产

### 6.3 视频审核

审核项：

- 节奏是否成立
- 镜头衔接是否自然
- 光影与空间是否连续
- 是否达到可交付标准

通过后：

- 可导出 / 可归档

驳回后：

- 回到视频重生成，或必要时回到分镜

## 7. 驳回原因结构化

驳回原因必须结构化，不能只留一句自由文本。

### 7.1 一级原因

- `continuity_issue`
- `character_issue`
- `location_issue`
- `prop_issue`
- `style_issue`
- `story_issue`
- `camera_issue`
- `pacing_issue`
- `quality_issue`
- `other`

### 7.2 二级原因示例

`continuity_issue`

- 上一镜承接失败
- 角色状态跳变
- 光线不连续

`character_issue`

- 变脸
- 服装错误
- 年龄/状态错误

`camera_issue`

- 景别不合适
- 运镜突兀
- 轴线错误

## 8. 返工规则

### 8.1 谁能发起返工

- `director`
- `reviewer`
- `producer`

### 8.2 谁能处理返工

- 资产问题 -> `artist`
- 分镜问题 -> `artist`
- 视频问题 -> `editor`
- 全局方向问题 -> `director` 决策后再派发

### 8.3 返工必须记录

- 发起人
- 责任人
- 原因代码
- 原因说明
- 截止时间
- 是否阻塞下游

## 9. 下游阻塞规则

### 9.1 资产被驳回

影响：

- 依赖它的未审核分镜全部标记风险
- 依赖它的待生成镜头禁止继续跑

### 9.2 分镜被驳回

影响：

- 视频阶段禁止继续推进
- 已生成的视频片段标记为 `needs_recheck`

### 9.3 视频被驳回

影响：

- 允许直接视频返工
- 若驳回原因是分镜问题，则回退到分镜阶段

## 10. 导演确认节点

有些内容不能只靠 reviewer。

建议以下对象支持 `director_confirmation_required`：

- 角色主设定
- 项目总风格
- 剧集关键分镜
- 最终成片

状态建议：

- `pending_director_confirmation`
- `director_confirmed`
- `director_rejected`

## 11. UI 映射

### 11.1 审核面板必须显示

- 当前状态
- 审核人
- 驳回原因
- 是否阻塞下游
- 返工责任人
- 最近一次审核时间

### 11.2 常用操作按钮

- `提交审核`
- `通过`
- `打回修改`
- `驳回重做`
- `指派返工`
- `标记导演确认`

### 11.3 列表页标识

在剧集列表、镜头列表、视频列表中统一用徽标展示：

- `待审核`
- `审核中`
- `需返工`
- `导演确认`
- `已通过`

## 12. 数据库映射建议

建议主要落在：

- `review_records`
- `approval_steps`
- `assignments`
- `change_events`
- `dependency_links`

额外建议字段：

### `review_records`

- `entity_type`
- `entity_id`
- `status`
- `reason_code`
- `reason_text`
- `submitter_user_id`
- `reviewer_user_id`
- `is_blocking_downstream`
- `requires_director_confirmation`

### `assignments`

- `entity_type`
- `entity_id`
- `assignee_user_id`
- `status`
- `due_at`

## 13. 错误边界

必须避免这些问题：

- 对象已驳回，但下游还在继续跑
- reviewer 没权通过却能强行通过
- 驳回后没有责任人
- 已通过对象被静默改写且没有新审核记录

## 14. 首版最小审核方案

如果要继续收敛，首版可以只做：

1. 单级审核，不做多级串行审批
2. `approved / changes_requested / rejected`
3. 驳回原因一级枚举 + 自由文本补充
4. 一条返工任务
5. 一条审核历史时间线

先把这套跑顺，再考虑企业版多级审批。

## 15. 下一步

建议下一步继续补：

1. `dependency_links` 的联动失效规则表
2. 审核面板线框
3. 错误码与 API 契约

