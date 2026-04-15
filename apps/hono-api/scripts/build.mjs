import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { build } = require('esbuild')

const projectRoot = path.resolve(process.cwd())
const outDir = path.join(projectRoot, 'dist')
fs.mkdirSync(outDir, { recursive: true })

await build({
  entryPoints: [path.join(projectRoot, 'src', 'main.ts')],
  outfile: path.join(outDir, 'main.js'),
  bundle: true,
  packages: 'external',
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: true,
  logLevel: 'info',
})
