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

export default defineConfig({
  root: webRoot,
  resolve: { alias: aliases },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [resolve(webRoot, '_test/setup.ts')],
    poolOptions: { threads: { minThreads: 1, maxThreads: 2 } },
  },
})
