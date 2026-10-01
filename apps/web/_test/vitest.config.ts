import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const webRoot = fileURLToPath(new URL('..', import.meta.url))
const tsconfig: { compilerOptions: { paths: Record<string, string[]> } } = JSON.parse(
  readFileSync(resolve(webRoot, 'tsconfig.json'), 'utf8'),
)
const aliases = Object.fromEntries(Object.entries(tsconfig.compilerOptions.paths)
  .map(([name, paths]) => [name, resolve(webRoot, paths[0])]))
aliases['@tapcanvas/image-prompt-spec'] = resolve(webRoot, '../../packages/schemas/image-prompt-spec/index.js')
aliases['@tapcanvas/image-view-controls'] = resolve(webRoot, '../../packages/schemas/image-view-controls/index.mjs')
aliases.zod = resolve(webRoot, 'node_modules/zod/index.js')
aliases['virtual:pwa-register/react'] = resolve(webRoot, '_test/stubs/pwa-register-react.ts')

export default defineConfig({
  root: webRoot,
  resolve: { alias: aliases },
  test: {
    environment: 'jsdom',
    globals: true,
    // Mirrors .env.example so modules that validate required VITE_* config at import time can load.
    env: {
      VITE_OBJECT_STORAGE_PROVIDER: 'tos',
      VITE_TOS_PUBLIC_BASE_URL: 'https://tanvas-ai.tos-cn-guangzhou.volces.com',
      VITE_R2_PUBLIC_BASE_URL: 'https://assets.tapcanvas.uk',
    },
    setupFiles: [resolve(webRoot, '_test/setup.ts')],
    poolOptions: { threads: { minThreads: 1, maxThreads: 2 } },
  },
})
