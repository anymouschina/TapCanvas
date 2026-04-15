import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@tapcanvas/canvas-plan-protocol': resolve(__dirname, '../../hono-api/src/modules/apiKey/canvasPlanProtocol.ts'),
      '@tapcanvas/flow-anchor-bindings': resolve(__dirname, '../../hono-api/src/modules/flow/flow.anchor-bindings.ts'),
      '@tapcanvas/image-prompt-spec': resolve(__dirname, '../../../packages/schemas/image-prompt-spec/index.js'),
      '@tapcanvas/image-view-controls': resolve(__dirname, '../../../packages/schemas/image-view-controls/index.mjs'),
    },
  },
  test: {
    include: ['_test/unit/**/*.test.ts', '_test/unit/**/*.test.tsx'],
    environment: 'jsdom',
    setupFiles: [resolve(__dirname, './vitest.setup.ts')],
    globals: true,
    clearMocks: true,
  },
})
