import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const { build } = require('esbuild')

const projectRoot = path.resolve(process.cwd())
const outDir = path.join(projectRoot, 'dist')
fs.mkdirSync(outDir, { recursive: true })

// —— 定向类型门禁：未声明标识符族（TS2304/2552/2662/2663/18004）——
// esbuild 不做类型检查，这族错误会原样打进产物、运行时炸 ReferenceError
// （2026-07-26 ch1341-v3 实测：`declaredSceneName is not defined` 卡死视频驱动 40 分钟）。
// 全量 tsc 门禁被存量类型错误所阻，先把「必然运行时崩溃」这一族挡死；其余错误只提示不拦截。
const REFERENCE_ERROR_RE = /error TS(2304|2552|2662|2663|18004):/
const tscBin = path.join(path.dirname(require.resolve('typescript/package.json')), 'bin', 'tsc')
const tsc = spawnSync(process.execPath, [tscBin, '--noEmit', '-p', 'tsconfig.json'], {
  cwd: projectRoot,
  encoding: 'utf8',
})
const tscOut = `${tsc.stdout || ''}${tsc.stderr || ''}`
const fatalLines = tscOut.split('\n').filter((line) => REFERENCE_ERROR_RE.test(line))
if (fatalLines.length > 0) {
  console.error('[typecheck-gate] 检出未声明标识符（运行时必炸 ReferenceError），拒绝打包：')
  for (const line of fatalLines) console.error(`  ${line}`)
  process.exit(1)
}
const totalErrors = (tscOut.match(/error TS\d+:/g) || []).length
if (totalErrors > 0) {
  console.warn(`[typecheck-gate] 存量类型错误 ${totalErrors} 个（未拦截）；ReferenceError 族 0 个，放行。`)
}

// 生产 dist 默认「混淆 + 无 sourcemap」——镜像是 public 的（beqlee/tapcanvas-*），
// dist/main.js 会被任何人 docker pull 后直读。minify 把本地标识符 mangle、去空白/注释，
// 显著抬高抄袭成本；sourcemap 必须关（.map 会把混淆完整还原，等于白混淆）。
// keepNames:true 保留函数/类的 .name（bundle 的是自家 src；若有 err.constructor.name /
//   instanceof 名称判断，全 mangle 会静默改变运行时行为），只混淆局部变量与结构。
// 需要排线上错误栈时：本地 BUILD_SOURCEMAP=1 pnpm build 生成 .map 自查，但绝不入镜像
//   （Dockerfile.prod 仍 rm -f dist/*.map 兜底）。
const wantSourcemap = process.env.BUILD_SOURCEMAP === '1'

await build({
  entryPoints: {
    main: path.join(projectRoot, 'src', 'main.ts'),
    'codex-remote-builder': path.join(projectRoot, 'scripts', 'codex-remote-builder.ts'),
    'async-image-worker': path.join(projectRoot, 'scripts', 'async-image-worker.ts'),
    'async-image-worker-health': path.join(projectRoot, 'scripts', 'async-image-worker-health.ts'),
    'inprocess-worker': path.join(projectRoot, 'scripts', 'inprocess-worker.ts'),
    'inprocess-worker-healthcheck': path.join(projectRoot, 'scripts', 'inprocess-worker-healthcheck.ts'),
    'workflow-runtime-worker': path.join(projectRoot, 'scripts', 'workflow-runtime-worker.ts'),
  },
  outdir: outDir,
  bundle: true,
  packages: 'external',
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  minify: true,
  keepNames: true,
  legalComments: 'none',
  sourcemap: wantSourcemap,
  logLevel: 'info',
})
