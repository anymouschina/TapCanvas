# 纳米漫剧流水线依赖联动规则

目标：定义“上游改动后，下游哪些对象失效、标红、阻塞、允许继续”的确定性规则，避免把回改传播逻辑散落在前端临时判断里。

相关文档：

- [Checklist](./NANO_COMIC_PIPELINE_CHECKLIST.md)
- [DB Draft](./NANO_COMIC_PIPELINE_DB_DRAFT.md)
- [Role Matrix](./NANO_COMIC_PIPELINE_ROLE_MATRIX.md)
- [Review Flow](./NANO_COMIC_PIPELINE_REVIEW_FLOW.md)

## 1. 原则

- 联动必须基于显式依赖，不靠猜测
- 上游变更先标记影响，再决定是否自动失效
- 失效、警告、可忽略三种结果必须区分
- 审核通过的对象也不能因为上游变化被静默保留
- 默认优先“显式暴露风险”，而不是偷偷放过

## 2. 依赖对象类型

首版只处理这些依赖关系：

1. `character -> shot`
2. `location -> shot`
3. `prop -> shot`
4. `style_profile -> shot`
5. `shot -> video_segment`
6. `storyboard_result -> shot_render`
7. `shot_render -> video_segment`
8. `episode -> review_record`

## 3. 联动结果级别

### 3.1 `warning`

含义：

- 下游对象可能受影响
- 不自动失效
- 需要人工确认或重新检查

适用：

- 非核心表情调整
- 辅助道具变化
- 轻微风格参数变化

### 3.2 `stale`

含义：

- 下游对象不再可信
- 保留原结果，但明确标记过期
- 不允许继续作为“已通过”状态向后推进

适用：

- 角色主设定变动
- 场景空间锚点变动
- 镜头构图核心变化

### 3.3 `blocked`

含义：

- 下游流程禁止继续运行
- 必须先修复或重算

适用：

- 上游对象被驳回
- 上下文缺失
- 关键依赖不存在

## 4. `dependency_links` 建议

建议 link type 至少有：

- `uses_character`
- `uses_location`
- `uses_prop`
- `uses_style_profile`
- `uses_reference_asset`
- `derived_from_shot`
- `derived_from_render`
- `derived_from_storyboard_result`

字段建议：

- `upstream_type`
- `upstream_id`
- `downstream_type`
- `downstream_id`
- `link_type`
- `impact_level`
- `created_at`

## 5. 规则表

### 5.1 角色改动

#### 角色主设定变更

例子：

- 脸型
- 发型
- 服装主设
- 年龄段
- 角色气质关键词

影响：

- 所有关联 `shot` -> `stale`
- 所有关联 `shot_render` -> `stale`
- 所有关联 `video_segment` -> `warning` 或 `stale`

处理：

1. 镜头列表标红
2. 已通过的镜头撤销为 `needs_recheck`
3. 视频片段至少标记 `needs_recheck`

#### 角色非核心变更

例子：

- 单场景情绪补充
- 次要表情包
- 可选服装 variant

影响：

- 关联 `shot` -> `warning`
- 不自动失效 `video_segment`

### 5.2 场景改动

#### 场景空间锚点变更

例子：

- 主门位置
- 香炉位置
- 王座朝向
- 东西南北镜位关系

影响：

- 关联 `shot` -> `stale`
- 正反打镜头优先标记 `blocked`，禁止继续生成视频
- 关联 `video_segment` -> `stale`

#### 场景装饰性变更

例子：

- 背景挂画
- 非固定摆件

影响：

- 关联 `shot` -> `warning`
- `video_segment` 默认不失效

### 5.3 道具改动

#### 固定道具变更

例子：

- 大殿香炉
- 主角佩剑
- 王冠

影响：

- 关联 `shot` -> `stale`
- 关联 `video_segment` -> `warning`

#### 非固定道具变更

影响：

- 关联 `shot` -> `warning`

### 5.4 风格改动

#### 全局风格锁变更

例子：

- 主调色
- 机位风格
- 视觉材质方向

影响：

- 未审核 `shot` -> `warning`
- 已审核 `shot` -> `needs_recheck`
- `video_segment` -> `warning`

处理：

- 不自动删除历史结果
- 但禁止把旧结果继续当作“最终已定版”

### 5.5 分镜改动

#### `shot` 内容改动

例子：

- 构图变了
- 景别变了
- 角色站位变了

影响：

- 关联 `shot_render` -> `stale`
- 关联 `video_segment` -> `blocked`

处理：

- 视频阶段必须回退
- 不能直接沿用旧视频

### 5.6 渲染结果改动

#### `shot_render` 候选切换

如果是同构图轻微替换：

- `video_segment` -> `warning`

如果是核心构图替换：

- `video_segment` -> `stale`

## 6. 状态传播规则

### 6.1 上游驳回

如果上游对象状态变为 `rejected`：

- 所有直接下游对象变为 `blocked`
- 所有间接下游对象变为 `warning`

### 6.2 上游打回修改

如果上游对象状态变为 `changes_requested`：

- 所有直接下游对象变为 `needs_recheck`
- 不自动删除结果

### 6.3 上游重新通过

如果上游对象重新 `approved`：

- 下游不自动恢复为 `approved`
- 只允许恢复到 `ready` 或 `needs_review`

## 7. UI 表现规则

### 7.1 镜头列表

状态标记建议：

- `红点`: stale
- `黄点`: warning
- `锁`: blocked

### 7.2 详情页顶部

必须显示：

- 当前对象依赖了谁
- 有多少下游对象受影响
- 当前联动级别
- 推荐动作

### 7.3 批量操作

需要支持：

- 批量标记已读风险
- 批量重新生成镜头
- 批量重新提交审核

## 8. 后端处理建议

### 8.1 变更入口统一写事件

任何这些动作都要写 `change_events`：

- 角色更新
- 场景更新
- 道具更新
- 风格更新
- 镜头更新
- 审核驳回

### 8.2 后端统一跑传播

不要前端自己算。

建议后端流程：

1. 读取被修改实体
2. 查 `dependency_links`
3. 生成影响列表
4. 写回受影响对象状态
5. 产出通知与待办

## 9. 错误边界

必须避免：

- 角色改了但镜头没有任何提示
- 分镜改了但视频仍显示已通过
- 风格改了但历史结果继续被当作当前版本
- reviewer 驳回后仍能直接导出成片

## 10. 首版最小联动

如果要继续收敛，首版只做这 4 条就够：

1. `character -> shot`
2. `location -> shot`
3. `shot -> video_segment`
4. `review reject -> downstream blocked`

先跑顺这 4 条，再补细粒度道具和风格。

## 11. 下一步

建议继续补：

1. 联动状态枚举与错误码
2. 审核面板和镜头列表的联动 UI 规则
3. `dependency_links` Prisma schema 草图

