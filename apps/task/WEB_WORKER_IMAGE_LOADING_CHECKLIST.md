# Web Worker Image Loading Checklist

- [x] 梳理当前图片资源链路，确认下载与解码入口仍在前端主线程
- [x] 设计 Web Worker 接入边界，保持 `resourceManager` 外部 API 不变
- [x] 新增图片传输 worker，并定义主线程/worker 消息契约
- [x] 将 `resourceManager` 下载阶段切到 worker 驱动，移除主线程直连远程 `fetch`
- [x] 保持现有解码/渲染契约可用，避免引入静默 fallback 双轨
- [x] 运行构建或类型检查验证实现
- [x] 根据实际完成情况回填并勾选清单

## Verification

- [x] 定向 TypeScript 校验通过：
  `pnpm --filter @tapcanvas/web exec tsc --noEmit --target ES2020 --lib ES2020,DOM,DOM.Iterable,WebWorker --jsx react-jsx --module ESNext --moduleResolution Bundler --strict --skipLibCheck src/domain/resource-runtime/model/resourceTypes.ts src/domain/resource-runtime/services/resourceCache.ts src/domain/resource-runtime/services/resourceReaper.ts src/domain/resource-runtime/services/resourceManager.ts src/domain/resource-runtime/services/imageTransport.protocol.ts src/domain/resource-runtime/services/imageTransport.worker.ts src/domain/resource-runtime/services/imageTransportClient.ts`
- [ ] 全量 `apps/web` TypeScript 校验通过
  当前未通过，存在大量与本次改动无关的仓库既有错误，例如 `src/canvas/Canvas.tsx`、`src/canvas/nodes/TaskNode.tsx`、`src/ui/NanoComicWorkspacePanel.tsx` 等。
