# 导演台（director-desk）· 引入说明

本目录是 [mangfufu/director-desk](https://github.com/mangfufu/director-desk)（MIT）的 Web 部分副本，
用于替换 TapCanvas 原有的自研导演台。上游版本：`0.4.8`。

## 为什么是副本而不是依赖

上游是一个自带 `index.html` 入口的独立 Vite 应用，不是可安装的组件库；TapCanvas 需要它作为
`/director-desk/` 子路径静态应用被同源 iframe 嵌入，这要求改动构建配置（`base` 与 `outDir`），
因此只能以副本形式纳入仓库。保留副本也便于后续按需同步上游改动。

## 与上游的差异

仅以下六处，其余文件与上游保持一致，便于对比升级：

1. **移除 `desktop/`（Electron 外壳）**：TapCanvas 只嵌入 Web 构建产物，不需要桌面端进程、
   MCP 服务与自动更新链路。
2. **`package.json` 收窄**：去掉 desktop 专用脚本与仅桌面端使用的依赖
   （`electron`、`electron-builder`、`electron-updater`、`playwright-core`、`@modelcontextprotocol/sdk`、
   `zod`、`js-yaml`、`semver`），保留 Web 构建与 `node:test` 所需的依赖。
   `package-lock.json` 随之重新生成，与上游不再逐字节一致。
3. **新增 `vite.config.ts`**：上游依赖 Vite 默认配置，这里固定 `base: '/director-desk/'`，
   并把产物输出到 `apps/web/public/director-desk/`。
4. **新增 `public/tapcanvas-host-bridge.js`（嵌入宿主桥）**：被 TapCanvas 以同源 iframe 嵌入时，
   在子文档里安装 `window.directorDesktop`，用 postMessage 与父页面通话，让导演台 AI 面板跑在
   TapCanvas 的对话链路上；独立打开导演台时完全不介入（`window.parent === window` 直接返回）。
   由 `index.html` 在模块入口之前加载。
5. **去掉顶部品牌块**：嵌入后 `D·` 标志、`导演台`、`AI 短剧预演` 与 TapCanvas 自身重复，
   从 `src/ui/layout.ts` 移除，菜单锚点改挂 `.topbar`（`src/ui/application-menu.ts`），
   对应 CSS 一并删除。
6. **桌面能力按存在性降级**（不伪造、也不留点了报错的入口）：
   - `src/ui/update-panel.ts`：没有 `update`/`onUpdate` 时不渲染更新入口。
   - `src/ui/ai-mcp.ts`：没有 `mcp` 能力时整块置灰并标注「桌面版提供」，并自行加载初始状态；
     `src/ui/ai-panel.ts` 不再把 `bridge.mcp()` 与渠道目录并列 `await`（否则 MCP 缺失会连带
     让渠道加载失败）。

同时移除了仅桌面端可运行的 `tests/*.test.cjs`（AI host、MCP、文件权限、自动更新等），
保留全部纯 Node 的 `tests/*.test.ts`。

## 工具目录导出

`scripts/emit-tool-catalog.mjs`（挂在 `prebuild`）把导演台自己的 `src/automation/contract.ts`
（工具名）与 `src/automation/tool-summaries.ts`（面向模型的短描述）投影成
`apps/hono-api/src/modules/task/director-desk-tool-catalog.generated.json`，供后端把
`director_*` 工具声明给模型。只做投影、不复制内容：参数契约仍由导演台在执行时校验，
避免两端各维护一份会漂移的 schema。

## 构建

```bash
# 首次
npm --prefix apps/director-desk install

# 构建到 apps/web/public/director-desk/
npm --prefix apps/director-desk run build
```

`apps/web` 的 `predev` / `prebuild` 会自动执行上面的构建，因此日常开发只需启动 Web。

产物 `apps/web/public/director-desk/` 是生成目录，不纳入版本管理。

## 运行时集成

Web 端通过同源 iframe 加载 `/director-desk/`。上游的桌面能力经 `window.directorDesktop` 桥接入，
该桥在纯 Web 环境下不存在，上游会自动降级（AI 面板禁用、MCP 不可用、导出走浏览器下载）。
TapCanvas 侧的接入点见 `apps/web/src/canvas/nodes/directorConsole/`。

## 许可

MIT，见 `LICENSE`。上游 `README.md` 中的第三方依赖与动作资源署名同样适用。
