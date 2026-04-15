# 纳米漫剧流水线数据库草图

目标：先确定实体、关系、状态、版本与约束，避免 UI 先行后反复打数据库补丁。

相关文档：

- [Checklist](./NANO_COMIC_PIPELINE_CHECKLIST.md)
- [Sitemap](./NANO_COMIC_PIPELINE_SITEMAP.md)

## 1. 建模原则

### 1.1 第一性原则

- 项目是生产容器
- 剧集是生产单元
- 镜头是最核心的最小执行单元
- 角色 / 场景 / 道具 / 风格属于可复用资产
- 审核、评论、返工必须是独立实体，不要塞进 JSON
- 版本与依赖关系必须可追溯

### 1.2 不做的错误设计

- 不把所有资产塞进一个超大 `project_assets` 表
- 不把审核流做成几个布尔字段
- 不把返工联动逻辑藏在前端临时计算里
- 不把智能体输出直接当成唯一权威数据源

## 2. 核心实体

### 2.1 身份与权限

#### `users`

- `id`
- `login`
- `name`
- `avatar_url`
- `email`
- `phone`
- `created_at`
- `updated_at`

#### `teams`

- `id`
- `name`
- `owner_user_id`
- `credits`
- `credits_frozen`
- `created_at`
- `updated_at`

#### `team_memberships`

- `id`
- `team_id`
- `user_id`
- `role`
- `status`
- `created_at`
- `updated_at`

角色建议：

- `owner`
- `director`
- `producer`
- `artist`
- `editor`
- `reviewer`
- `member`

### 2.2 业务主实体

#### `projects`

- `id`
- `team_id`
- `owner_user_id`
- `title`
- `description`
- `format_type`
- `status`
- `current_stage`
- `cover_asset_id`
- `created_at`
- `updated_at`

#### `episodes`

- `id`
- `project_id`
- `episode_no`
- `title`
- `source_script_asset_id`
- `status`
- `current_stage`
- `shot_count`
- `video_segment_count`
- `created_at`
- `updated_at`

#### `scenes`

- `id`
- `episode_id`
- `scene_no`
- `title`
- `summary`
- `source_range`
- `emotion_curve`
- `status`
- `created_at`
- `updated_at`

#### `shots`

- `id`
- `episode_id`
- `scene_id`
- `shot_no`
- `title`
- `summary`
- `duration_sec`
- `shot_type`
- `camera_movement`
- `lighting_hint`
- `continuity_status`
- `status`
- `approved_result_id`
- `created_at`
- `updated_at`

## 3. 资产模型

### 3.1 统一资产主表

#### `assets`

- `id`
- `project_id`
- `asset_type`
- `name`
- `status`
- `source_type`
- `current_version_id`
- `created_by`
- `created_at`
- `updated_at`

资产类型建议：

- `character`
- `location`
- `prop`
- `style_profile`
- `reference_image`
- `script_doc`
- `storyboard_frame`
- `video_segment`

### 3.2 资产版本

#### `asset_versions`

- `id`
- `asset_id`
- `version_no`
- `content_json`
- `preview_asset_id`
- `change_summary`
- `created_by`
- `created_at`

### 3.3 角色

#### `characters`

- `id`
- `project_id`
- `asset_id`
- `name`
- `role_type`
- `gender`
- `age_range`
- `base_profile_json`
- `voice_profile_json`
- `status`
- `created_at`
- `updated_at`

#### `character_variants`

- `id`
- `character_id`
- `variant_type`
- `variant_name`
- `state_tags`
- `asset_version_id`
- `created_at`
- `updated_at`

### 3.4 场景

#### `locations`

- `id`
- `project_id`
- `asset_id`
- `name`
- `location_type`
- `space_profile_json`
- `time_of_day_default`
- `lighting_profile_json`
- `status`
- `created_at`
- `updated_at`

#### `scene_layout_anchors`

- `id`
- `location_id`
- `anchor_key`
- `anchor_type`
- `position_json`
- `rotation_json`
- `is_fixed`
- `created_at`
- `updated_at`

### 3.5 道具

#### `props`

- `id`
- `project_id`
- `asset_id`
- `name`
- `prop_type`
- `is_fixed_to_location`
- `default_location_id`
- `profile_json`
- `status`
- `created_at`
- `updated_at`

### 3.6 风格配置

#### `style_profiles`

- `id`
- `project_id`
- `asset_id`
- `name`
- `style_lock_prompt`
- `negative_prompt`
- `cinematography_json`
- `palette_json`
- `created_at`
- `updated_at`

## 4. 生产结果

### 4.1 分镜结果

#### `storyboard_results`

- `id`
- `shot_id`
- `asset_version_id`
- `source_task_id`
- `result_type`
- `prompt_text`
- `continuity_guard`
- `score_json`
- `status`
- `created_at`
- `updated_at`

### 4.2 镜头渲染

#### `shot_renders`

- `id`
- `shot_id`
- `storyboard_result_id`
- `model_key`
- `task_attempt_id`
- `image_asset_id`
- `is_selected`
- `qc_status`
- `created_at`
- `updated_at`

### 4.3 视频片段

#### `video_segments`

- `id`
- `episode_id`
- `segment_no`
- `source_shot_start_id`
- `source_shot_end_id`
- `video_asset_id`
- `status`
- `qc_status`
- `created_at`
- `updated_at`

## 5. 任务执行与智能体

### 5.1 通用任务表

#### `generation_tasks`

- `id`
- `project_id`
- `episode_id`
- `entity_type`
- `entity_id`
- `task_type`
- `status`
- `requested_by`
- `started_at`
- `finished_at`
- `created_at`
- `updated_at`

任务类型建议：

- `asset_extract`
- `storyboard_plan`
- `shot_render`
- `shot_rerender`
- `video_generate`
- `continuity_check`
- `review_prepare`

### 5.2 尝试记录

#### `task_attempts`

- `id`
- `task_id`
- `attempt_no`
- `model_key`
- `agent_key`
- `input_snapshot_json`
- `output_snapshot_json`
- `error_code`
- `error_message`
- `status`
- `started_at`
- `finished_at`

### 5.3 任务产出引用

#### `task_outputs`

- `id`
- `task_id`
- `output_type`
- `output_ref_id`
- `output_ref_type`
- `is_primary`
- `created_at`

## 6. 一致性与上下文

### 6.1 连续性档案

#### `continuity_profiles`

- `id`
- `project_id`
- `episode_id`
- `profile_type`
- `entity_type`
- `entity_id`
- `profile_json`
- `created_at`
- `updated_at`

### 6.2 镜头上下文快照

#### `shot_context_snapshots`

- `id`
- `shot_id`
- `previous_shot_id`
- `next_shot_id`
- `tail_frame_asset_id`
- `context_json`
- `created_at`

### 6.3 参考绑定

#### `reference_bindings`

- `id`
- `entity_type`
- `entity_id`
- `reference_asset_id`
- `binding_type`
- `priority`
- `created_at`

## 7. 协作与审核

### 7.1 评论线程

#### `comment_threads`

- `id`
- `project_id`
- `entity_type`
- `entity_id`
- `status`
- `created_by`
- `created_at`
- `updated_at`

#### `comments`

- `id`
- `thread_id`
- `author_user_id`
- `content`
- `mentions_json`
- `status`
- `created_at`
- `updated_at`

### 7.2 审核记录

#### `review_records`

- `id`
- `project_id`
- `entity_type`
- `entity_id`
- `submitter_user_id`
- `reviewer_user_id`
- `status`
- `reason_code`
- `reason_text`
- `created_at`
- `updated_at`

审核状态建议：

- `pending`
- `approved`
- `rejected`
- `changes_requested`

### 7.3 审核步骤

#### `approval_steps`

- `id`
- `review_record_id`
- `step_no`
- `role_required`
- `reviewer_user_id`
- `status`
- `acted_at`
- `created_at`

### 7.4 指派

#### `assignments`

- `id`
- `project_id`
- `entity_type`
- `entity_id`
- `assignee_user_id`
- `assigner_user_id`
- `status`
- `due_at`
- `created_at`
- `updated_at`

### 7.5 通知

#### `notifications`

- `id`
- `user_id`
- `team_id`
- `notification_type`
- `entity_type`
- `entity_id`
- `payload_json`
- `read_at`
- `created_at`

## 8. 版本与追溯

### 8.1 通用变更事件

#### `change_events`

- `id`
- `project_id`
- `entity_type`
- `entity_id`
- `event_type`
- `actor_user_id`
- `payload_json`
- `created_at`

### 8.2 依赖关系

#### `dependency_links`

- `id`
- `upstream_type`
- `upstream_id`
- `downstream_type`
- `downstream_id`
- `link_type`
- `created_at`

这张表用于：

- 角色改动后查出受影响镜头
- 场景改动后查出受影响视频
- 风格改动后查出受影响结果

## 9. 资源与成本

### 9.1 团队积分

#### `credit_ledger`

- `id`
- `team_id`
- `entry_type`
- `amount`
- `related_task_id`
- `note`
- `created_at`

### 9.2 模型消耗

#### `model_usage_logs`

- `id`
- `project_id`
- `episode_id`
- `task_id`
- `model_key`
- `vendor_key`
- `usage_type`
- `request_units`
- `cost_amount`
- `created_at`

### 9.3 团队日统计

#### `team_usage_daily`

- `id`
- `team_id`
- `date_key`
- `task_count`
- `render_count`
- `video_count`
- `credit_spent`
- `created_at`
- `updated_at`

## 10. 关系草图

```text
team -> projects -> episodes -> scenes -> shots
project -> assets -> asset_versions
project -> characters / locations / props / style_profiles
shot -> storyboard_results -> shot_renders
episode -> video_segments
entity -> comment_threads -> comments
entity -> review_records -> approval_steps
entity -> assignments
task -> task_attempts -> task_outputs
entity <-> dependency_links <-> entity
```

## 11. 枚举建议

### 11.1 项目状态

- `draft`
- `active`
- `paused`
- `archived`

### 11.2 剧集状态

- `draft`
- `asset_preparing`
- `storyboard_in_progress`
- `video_in_progress`
- `review_in_progress`
- `approved`
- `archived`

### 11.3 镜头状态

- `draft`
- `ready`
- `generating`
- `candidate_ready`
- `needs_review`
- `approved`
- `rejected`
- `failed`

### 11.4 资产状态

- `draft`
- `active`
- `deprecated`
- `archived`

## 12. 必须提前确认的约束

- [ ] `episodes(project_id, episode_no)` 唯一
- [ ] `shots(episode_id, shot_no)` 唯一
- [ ] 当前激活版本只能有一个
- [ ] 通过审核的记录是否允许再次编辑
- [ ] 已通过的视频是否因上游变更自动失效
- [ ] 删除项目时是否级联软删除全部下游数据

## 13. 对当前仓库的映射建议

优先复用现有方向：

- 团队与 credits 走现有 `team` 体系
- storyboard 能力尽量挂在现有 `storyboard` 模块之上
- 任务执行日志尽量与现有 task / diagnostics 体系对齐
- 节点审批状态可复用现有 `approvalStatus` 概念，但必须升级为独立审核记录

不要直接这么做：

- 不要继续把复杂生产结果只放在 `book index.json` 里
- 不要把评论/审核继续塞进节点 `data` JSON
- 不要用前端临时推导代替正式依赖图

## 14. 下一步

建议下一步继续补：

1. `角色权限矩阵`
2. `审核状态流转图`
3. `dependency_links` 联动规则表
4. `generation_tasks` 与智能体输入输出契约

