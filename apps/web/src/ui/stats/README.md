# /stats 看板模块（前端）

目标：保持 `/stats` 管理后台聚焦，只提供概览、用户管理和任务日志三个入口。

## 目录结构

- `StatsFullPage.tsx`：`/stats` 总入口与概览
- `../StatsUserManagement.tsx`：用户管理
- `system/`
  - `StatsTaskLogs.tsx`：生成任务日志的条件查询、详情和服务端分页
- `statsRoutes.ts`：仅声明 `overview / users / task-logs` 三个可访问区段；其他 `/stats/*` 路径回到概览

## 扩展建议

- 服务端日志必须使用真实分页与可验证条件，不在前端截取完整数据伪造分页。
- 新增后台 Tab 前必须先确认其属于后台核心职责，避免重新扩张为综合配置中心。
