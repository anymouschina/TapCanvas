# TapCanvas vs waoowaoo：差距与执行清单

更新时间：2026-03-02

## 对比范围

- TapCanvas：`/Users/libiqiang/workspace/TapCanvas-pro`
- waoowaoo：`/Users/libiqiang/workspace/waoowaoo`
- 主要依据：`README.md`、`package.json`、目录结构、测试与脚本分布

## 差距总览（按优先级）

| 维度 | 我们当前状态（TapCanvas） | 对比项目状态（waoowaoo） | 差距判断 | 优先级 |
|---|---|---|---|
| 回归门禁流程 | CI 以构建部署为主（`.github/workflows/cloudflare-deploy.yml`），缺少完整 test/guard 门禁链 | `package.json` 内置完整 `test:regression`、`test:pr`、`check:*` 组合 | **明显差距**：发布前质量门禁不完整 | P0 |
| 自动化测试覆盖 | 测试文件约 17 个，且有一部分在 `apps/Tigshop-master`，核心链路测试密度偏低 | 测试文件约 100 个，覆盖 unit/integration/concurrency/contracts/chain | **明显差距**：核心业务回归保护不足 | P0 |
| 变更守卫（Guardrails） | `scripts` 仅约 4 个，缺少“禁止退化/禁止绕过”的自动守卫脚本体系 | `scripts` 约 32 个，含大量 `check:*`（模型、路由、覆盖率、prompt 回归等） | **明显差距**：规则依赖人工审查，稳定性风险更高 | P0 |
| 工程约束显式化 | 根 `package.json` 缺少系统化的 check/test 任务矩阵 | `package.json` 中对规范有明确可执行入口（例如 coverage guards、contract checks） | **中等差距**：规范可执行性不足 | P1 |
| 仓库聚焦度 | 单仓同时存在 `apps/web`、`apps/hono-api`、`apps/webcut-main`、`apps/Tigshop-master` 等多套体系 | 单主应用目录更聚焦（`src` + `tests` + `scripts`） | **中等差距**：认知负担和维护边界更重 | P1 |
| 生产配套能力（队列/后台任务） | 当前主叙事偏“画布+接口”，后台异步体系在入口层可见度较低 | 明确有 worker/watchdog/bull-board 并联运行脚本 | **中等差距**：大规模任务处理与观测入口不够完整 | P2 |

## 关键证据

- 测试数量对比：
  - TapCanvas：`rg --files -g '**/*.{test,spec}.{ts,tsx,js,jsx}' | wc -l` => `17`
  - waoowaoo：`rg --files -g '**/*.{test,spec}.{ts,tsx,js,jsx}' /Users/libiqiang/workspace/waoowaoo | wc -l` => `100`
- 脚本数量对比：
  - TapCanvas：`ls -1 scripts | wc -l` => `4`
  - waoowaoo：`ls -1 /Users/libiqiang/workspace/waoowaoo/scripts | wc -l` => `32`
- CI 对比：
  - TapCanvas 当前可见 workflow：`cloudflare-deploy.yml`（安装、构建、部署）
  - waoowaoo 以 npm scripts 为核心建立了多层回归检查链（`check:*` + `test:*`）

## 两周执行版（建议直接按这个做）

1. 第 1-2 天：补齐质量门禁入口
   - 增加统一脚本：`check:guards`、`test:unit:core`、`test:integration:core`、`test:regression`
   - 把 CI 从“仅 build”改为“install -> guards -> tests -> build -> deploy”
   - 验收标准：任意 PR 若未通过 guards/tests，不能进入部署步骤
2. 第 3-7 天：补核心链路测试矩阵（最小闭环）
   - 覆盖 4 条主链路：节点执行、模型路由、资产写回、agents pipeline 回填
   - 每条链路至少 1 个成功用例 + 1 个失败用例（显式报错，不允许静默兜底）
   - 验收标准：新增核心测试 >= 12 个，失败场景断言包含明确错误原因
3. 第 8-10 天：补守卫脚本（防退化）
   - 新增守卫：禁止硬编码模型候选、禁止隐式降级、禁止绕过统一模型目录
   - 验收标准：守卫脚本可在本地和 CI 都一键执行，并拦截对应违规代码
4. 第 11-14 天：收敛仓库边界与运行面
   - 形成主产品目录白名单（哪些参与 CI，哪些归档/隔离）
   - 输出一次目录治理清单（保留/迁移/冻结）
   - 验收标准：新同学可在 10 分钟内定位“主链路代码 + 测试 + 脚本入口”

## 你可以直接看的一个结论

- 现在最缺的不是“新功能”，而是“可持续迭代的防退化系统”。
- 先把 P0（门禁 + 测试 + 守卫）补齐，再做大功能，迭代速度会更快且返工更少。

## 已落地（本次）

- 根脚本新增：
  - `check:guards`
  - `test:unit:core`
  - `test:integration:core`
  - `test:regression`
  - `ci:quality`
- 新增 guard 脚本：
  - `scripts/guards/no-merge-conflict-markers.mjs`
  - `scripts/guards/no-debugger-statement.mjs`
- 新增 CI：
  - `.github/workflows/quality-gate.yml`
- API 测试从占位升级为真实执行：
  - `apps/hono-api/package.json` 的 `test` 已切到 `vitest run`
  - 新增 `apps/hono-api/vitest.config.ts`
  - 新增测试：`src/config.test.ts`、`src/jwt.test.ts`、`src/trace.test.ts`
