# 纳米漫剧流水线状态徽标与颜色系统

目标：统一项目、剧集、资产、镜头、视频、审核、风险的视觉语义，避免不同页面各自定义状态颜色和徽标文案。

相关文档：

- [Sitemap](./NANO_COMIC_PIPELINE_SITEMAP.md)
- [Review Flow](./NANO_COMIC_PIPELINE_REVIEW_FLOW.md)
- [Dependency Rules](./NANO_COMIC_PIPELINE_DEPENDENCY_RULES.md)
- [Review Center Wireframe](./NANO_COMIC_PIPELINE_REVIEW_CENTER_WIREFRAME.md)
- [Shot Workspace Sidebar](./NANO_COMIC_PIPELINE_SHOT_WORKSPACE_SIDEBAR.md)

## 1. 原则

- 同一状态在全站只能有一套主颜色
- 审核状态和风险状态必须区分，不可共用一套颜色语义
- 文案优先短而准，不要每个页面写不同别名
- 徽标颜色是状态提示，不代替详细原因
- 所有颜色都需要配合图标或文字，不能只靠颜色传达

## 2. 状态分类

首版建议分成 4 大类：

1. 生产状态
2. 审核状态
3. 风险状态
4. 协作状态

## 3. 生产状态

### 3.1 枚举

- `draft`
- `ready`
- `queued`
- `running`
- `candidate_ready`
- `completed`
- `failed`
- `archived`

### 3.2 展示规范

| 状态 | 中文文案 | 建议颜色 | 图标语义 |
|---|---|---|---|
| `draft` | 草稿 | gray | 空心圆 |
| `ready` | 就绪 | blue | 小圆点 |
| `queued` | 排队中 | indigo | 时钟 |
| `running` | 生成中 | cyan | 旋转/加载 |
| `candidate_ready` | 候选已出 | violet | 图层/候选 |
| `completed` | 已完成 | green | 勾 |
| `failed` | 失败 | red | 感叹号 |
| `archived` | 已归档 | dark gray | 文件盒 |

## 4. 审核状态

### 4.1 枚举

- `pending_review`
- `in_review`
- `changes_requested`
- `approved`
- `rejected`
- `pending_director_confirmation`
- `director_confirmed`
- `director_rejected`

### 4.2 展示规范

| 状态 | 中文文案 | 建议颜色 | 图标语义 |
|---|---|---|---|
| `pending_review` | 待审核 | blue | 送审 |
| `in_review` | 审核中 | cyan | 眼睛 |
| `changes_requested` | 需修改 | orange | 回退箭头 |
| `approved` | 已通过 | green | 勾 |
| `rejected` | 已驳回 | red | 叉 |
| `pending_director_confirmation` | 待导演确认 | violet | 皇冠/星 |
| `director_confirmed` | 导演已确认 | grape | 皇冠勾 |
| `director_rejected` | 导演驳回 | magenta | 皇冠叉 |

## 5. 风险状态

### 5.1 枚举

- `normal`
- `warning`
- `stale`
- `blocked`

### 5.2 展示规范

| 状态 | 中文文案 | 建议颜色 | 图标语义 |
|---|---|---|---|
| `normal` | 正常 | gray | 无 |
| `warning` | 风险提醒 | yellow | 三角警告 |
| `stale` | 结果过期 | orange | 时效失效 |
| `blocked` | 已阻塞 | red | 锁/禁止 |

## 6. 协作状态

### 6.1 枚举

- `assigned`
- `in_progress`
- `waiting_feedback`
- `rework_open`
- `rework_in_progress`
- `done`

### 6.2 展示规范

| 状态 | 中文文案 | 建议颜色 | 图标语义 |
|---|---|---|---|
| `assigned` | 已指派 | blue | 用户 |
| `in_progress` | 处理中 | cyan | 运行 |
| `waiting_feedback` | 等待反馈 | yellow | 对话 |
| `rework_open` | 待返工 | orange | 回转箭头 |
| `rework_in_progress` | 返工中 | deep orange | 工具 |
| `done` | 已完成 | green | 勾 |

## 7. 文案长度规则

### 7.1 列表页

- 统一使用 2-4 字短文案
- 例如：`待审`、`返工中`、`已阻塞`

### 7.2 详情页

- 可以使用完整文案
- 例如：`角色主设已更新，当前镜头结果过期`

## 8. 显示层级规则

### 8.1 列表行

一行最多同时展示：

- 1 个生产状态
- 1 个审核状态
- 1 个风险状态

不要在一行塞 5 个 badge。

### 8.2 详情页

详情页可分层展示：

- 顶部：主状态
- 次行：风险状态
- 文本区：详细原因

## 9. 组合示例

### 9.1 镜头已生成但需审核

- 生产状态：`候选已出`
- 审核状态：`待审核`
- 风险状态：`正常`

### 9.2 角色改动导致镜头过期

- 生产状态：`已完成`
- 审核状态：`需复检` 或 `需修改`
- 风险状态：`结果过期`

### 9.3 上游被驳回导致视频不能继续

- 生产状态：`已完成`
- 审核状态：`待处理`
- 风险状态：`已阻塞`

## 10. 色板建议

建议只用语义色，不要乱扩散品牌色：

- gray: 中性
- blue: 待处理
- cyan: 进行中
- violet/grape: 导演或高级确认
- green: 通过/完成
- yellow: 轻风险
- orange: 需修改/过期
- red: 驳回/阻塞/失败

## 11. 组件建议

建议统一抽象两个组件：

### 11.1 `StatusBadge`

输入：

- `kind`: `production | review | risk | collaboration`
- `value`
- `compact`

### 11.2 `StatusSummary`

用于详情页顶部汇总，支持：

- 主状态
- 风险状态
- 辅助说明

## 12. 对当前仓库的落地建议

建议统一沉淀在：

- `apps/web/src/ui/.../status-tokens.ts`
- `apps/web/src/ui/.../StatusBadge.tsx`

不要：

- 在每个页面手写一套 `if status === ...`
- 把 badge 文案散落在多个组件里

## 13. 下一步

建议继续补：

1. 状态图标映射
2. 颜色 token 与 className 规范
3. 镜头列表行与审核中心行的共用 badge 规则

