# 纳米漫剧流水线 UI 页面树

目标：先把页面结构、入口关系、核心职责和状态流转钉死，避免 UI 做成一堆功能堆叠页。

相关文档：

- [Checklist](./NANO_COMIC_PIPELINE_CHECKLIST.md)
- [DB Draft](./NANO_COMIC_PIPELINE_DB_DRAFT.md)
- [Project Integration](./NANO_COMIC_PIPELINE_PROJECT_INTEGRATION.md)

## 1. 产品分层

产品建议拆成 4 层：

1. 总览层
2. 项目生产层
3. 协作审核层
4. 诊断与系统层

原则：

- 首页只看全局进度，不承担细节生产
- 项目工作台承担主生产逻辑
- 审核中心承担跨项目/跨剧集的待办收敛
- 诊断页承担失败与质量问题定位

## 1.1 与当前 TapCanvas 的接法

这里不要按独立 SaaS 后台理解。

这个仓库当前真实结构是：

1. `/projects` 负责选项目
2. 进入主应用后由 `currentProject` 决定当前项目上下文
3. 主要生产行为发生在同一个 `CanvasApp` 中

因此漫剧流水线首版应按下面方式集成：

- 保留 `/projects` 作为项目列表与选择页
- 选中项目后返回当前画布页
- 在当前页内通过 `FloatingNav` 打开 `漫剧工作台`
- 工作台是项目内 workspace，不是新的独立应用壳
- 产物可以直接加入当前画布，不做平行产物系统

## 2. 页面树

如果只从产品概念看，完整形态可以抽象成下面这些页面状态。

```text
/dashboard
/projects
/projects/:projectId
/projects/:projectId/overview
/projects/:projectId/episodes
/projects/:projectId/assets
/projects/:projectId/storyboard
/projects/:projectId/video
/projects/:projectId/reviews
/projects/:projectId/settings
/episodes/:episodeId
/episodes/:episodeId/outline
/episodes/:episodeId/assets
/episodes/:episodeId/storyboard
/episodes/:episodeId/video
/episodes/:episodeId/review
/review-center
/review-center/pending
/review-center/history
/team
/team/members
/team/roles
/team/notifications
/diagnostics
/diagnostics/generation
/diagnostics/continuity
/diagnostics/cost
```

但结合当前仓库真实结构，首版 UI 不建议全部落成独立 route。

更贴近当前项目的实现树应是：

```text
/projects
  -> 选择项目
  -> 设置 currentProject
  -> 返回 CanvasApp

CanvasApp
  -> FloatingNav
    -> 工作流
    -> 我的资产
    -> 运行记录
    -> 漫剧工作台（新增）

漫剧工作台（当前页内 workspace）
  -> 项目概览
  -> 分镜工作台
  -> 审核中心
```

## 3. 导航建议

### 3.1 一级导航

- `总览`
- `项目`
- `审核中心`
- `团队`
- `诊断`

结合当前仓库首版实现，建议收敛成：

- `/projects` 做项目选择
- `FloatingNav` 做项目内一级入口
- `漫剧工作台` 内再做二级页签

### 3.2 二级导航

项目内：

- `概览`
- `剧集`
- `资产库`
- `分镜`
- `视频`
- `审核`
- `设置`

首版建议只先做：

- `概览`
- `分镜`
- `审核`

剧集内：

- `大纲`
- `资产`
- `分镜`
- `视频`
- `审核`

## 4. 关键页面职责

### 4.1 `/dashboard`

作用：给导演/负责人看全局状态。

模块：

- 进行中项目
- 剧集进度总览
- 待审核数量
- 今日返工次数
- 模型/积分消耗
- 最近活动流

不做：

- 不在这里直接编辑镜头
- 不在这里直接做资产细改

### 4.2 `/projects`

作用：项目入口页。

模块：

- 项目卡片
- 项目状态筛选
- 项目搜索
- 新建项目
- 最近访问

项目卡片至少展示：

- 项目名
- 剧集数
- 当前阶段
- 待审核数
- 最近更新时间
- 团队成员数

### 4.3 `/projects/:projectId/overview`

作用：单项目总控页。

模块：

- 项目阶段进度条
- 剧集列表摘要
- 资产完整度
- 分镜完成度
- 视频完成度
- 待审核与返工统计
- 最近评论/动态

右侧侧栏：

- 导演提醒
- 阻塞项
- 智能体建议

### 4.4 `/projects/:projectId/episodes`

作用：管理剧集与每集状态。

模块：

- 剧集列表
- 状态筛选
- 一键进入剧集工作台
- 批量指派
- 批量提交审核

列表字段建议：

- 剧集编号
- 标题
- 当前阶段
- 分镜完成度
- 视频完成度
- 待审核
- 最后操作人
- 更新时间

### 4.5 `/projects/:projectId/assets`

作用：项目级资产库。

页签建议：

- `角色`
- `场景`
- `道具`
- `风格`
- `镜头资产`

通用能力：

- 搜索
- 标签筛选
- 版本历史
- 被哪些剧集/镜头引用
- 一键复用
- 一键标记失效

### 4.6 `/projects/:projectId/storyboard`

作用：项目级分镜总览，偏管理视图。

模块：

- 剧集分镜进度
- 连续性告警汇总
- 待重绘镜头
- 待选择候选镜头
- 待导演确认镜头

### 4.7 `/episodes/:episodeId/storyboard`

作用：核心生产页。

这是最重要的页面。

在当前仓库里，首版可以不做独立 route，而是在 `CanvasApp` 内以 workspace 视图打开。

布局建议：

- 左栏：镜头列表 / 结构树
- 中栏：当前镜头主预览
- 右栏：上下文 / 候选 / 评论 / 审核
- 顶栏：阶段导航 + 当前状态 + 快捷操作
- 底栏：镜头操作条

必须有的能力：

- 上一镜 / 当前镜 / 下一镜联看
- 尾帧承接预览
- 重绘
- 候选切换
- 回退历史
- 一致性告警
- 评论
- 提交审核

### 4.8 `/episodes/:episodeId/video`

作用：把镜头组装成视频片段并管理返工。

模块：

- 视频片段列表
- 输入镜头关联
- 视频预览
- 节奏与运镜建议
- 重生成
- 审核状态

### 4.9 `/episodes/:episodeId/review`

作用：剧集内审核收口。

模块：

- 待审核资产
- 待审核分镜
- 待审核视频
- 驳回原因统计
- 最近审核历史

审核动作：

- 通过
- 驳回
- 驳回并指派
- 标记需要导演确认

### 4.10 `/review-center/pending`

作用：跨项目待办池。

适合导演、制片、审核人。

筛选维度：

- 项目
- 剧集
- 类型
- 状态
- 指派人
- 优先级

### 4.11 `/team/members`

作用：团队成员与职责管理。

模块：

- 成员列表
- 当前角色
- 负责项目 / 剧集
- 在线状态
- 最近活动

### 4.12 `/team/notifications`

作用：统一提醒收口。

提醒类型：

- 评论 @我
- 待审核
- 被驳回
- 已通过
- 生成失败
- 资产失效联动

### 4.13 `/diagnostics/generation`

作用：看生成链路问题。

模块：

- 任务日志
- 失败任务列表
- 模型调用记录
- 重试次数
- 错误码分布

### 4.14 `/diagnostics/continuity`

作用：看质量问题，不只看系统错误。

模块：

- 角色一致性告警
- 场景一致性告警
- 分镜跳脱告警
- 视频衔接风险

### 4.15 `/diagnostics/cost`

作用：看成本与消耗。

模块：

- 团队消耗趋势
- 项目消耗排名
- 剧集消耗排名
- 模型成本对比
- 返工成本占比

## 5. 关键交互流

### 5.1 新项目创建流

1. 创建项目
2. 选择剧集模板
3. 导入剧本/小说
4. 生成剧集结构
5. 进入项目总览

### 5.2 剧集生产流

1. 进入剧集
2. 补充/确认资产
3. 生成分镜
4. 检查一致性
5. 选候选 / 重绘
6. 提交审核
7. 通过后进入视频阶段

### 5.3 驳回返工流

1. 审核人驳回
2. 选择驳回原因
3. 指定返工责任人
4. 标记受影响下游内容
5. 返工人修改
6. 再次提交审核

### 5.4 资产回改联动流

1. 修改角色/场景/风格
2. 系统识别受影响镜头
3. 标记红点与失效状态
4. 允许批量重跑或逐个处理

## 6. 页面状态统一建议

统一页面状态：

- `empty`
- `draft`
- `ready`
- `running`
- `needs_review`
- `rejected`
- `approved`
- `failed`

统一提示区块：

- 当前状态
- 阻塞原因
- 上一步来源
- 下一步推荐动作

## 7. 第一版 UI MVP

第一版真正要先做的页面：

1. `/dashboard`
2. `/projects`
3. `/projects/:projectId/overview`
4. `/projects/:projectId/assets`
5. `/episodes/:episodeId/storyboard`
6. `/episodes/:episodeId/review`
7. `/review-center/pending`

首版先不做复杂页：

- 企业高级统计
- 高级权限配置器
- 外部分享门户
- 高级空间布局编辑器

## 8. 对当前仓库的映射建议

建议优先落在：

- `apps/web/src/ui/` 新增漫剧工作台页面
- `apps/web/src/canvas/` 复用已有节点与产线状态能力
- `apps/web/src/ui/stats/` 诊断与统计可复用现有面板结构
- `apps/hono-api/src/modules/storyboard/` 作为分镜主链基础
- `apps/hono-api/src/modules/team/` 作为团队能力基础

不建议：

- 一开始把全部逻辑继续塞进当前聊天面板
- 一开始继续做“本地流水线式”的独立旁路工作流
