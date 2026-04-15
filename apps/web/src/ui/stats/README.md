# /stats 看板模块（前端）

目标：把“/stats 管理后台”的代码按功能域拆分，避免所有逻辑堆在 `src/ui` 根目录里。

## 目录结构

- `StatsFullPage.tsx`：/stats 总入口（分段导航：overview / system / skills / enterprise / users / projects）
- `system/`
  - `StatsSystemManagement.tsx`：系统管理入口（API Key、调用日志、模型管理等）
  - `StatsPublicApiDebugger.tsx`：Public API 调试器
  - `modelCatalog/`：模型管理（系统级）
    - `StatsModelCatalogManagement.tsx`：组合入口（加载/过滤/导入导出/弹窗编排）
    - `ModelCatalog*Section.tsx`：按功能拆分（导入、厂商、模型、映射）
    - `modals/`：按弹窗拆分（厂商编辑、厂商 Key、模型编辑、映射编辑）
    - `deps.ts`：集中管理对 `api/server` + `toast` 的依赖（避免深层相对路径到处重复）
    - `modelCatalog.constants.ts` / `modelCatalog.utils.ts`：常量与纯工具函数
- `skills/`
  - `StatsSkillManagement.tsx`：Skill（画布 AI 对话框）管理入口
- `enterprise/`
  - `StatsEnterpriseManagement.tsx`：企业/团队管理入口
  - `StatsPlanManagement.tsx`：历史计费配置页（模型价格已并入 `system/modelCatalog`）
- `projects/`
  - `StatsProjectManagement.tsx`：项目管理（admin-only，/admin/projects）

## 扩展建议

- 新增“系统级能力”（例如新增某类配置面板）：优先放在 `system/` 下新建模块文件，保持 `StatsSystemManagement.tsx` 只做组合。
- 新增“厂商/模型/映射”相关能力：优先在 `system/modelCatalog/***` 内按功能新增 `Section`/`Modal`，并复用 `deps.ts`、`constants`、`utils`。
