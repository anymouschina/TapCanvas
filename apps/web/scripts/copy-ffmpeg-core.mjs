// 把 @ffmpeg/core 的 ESM 产物复制到 web 的 public/ffmpeg/。
// 在 predev / prebuild 自动跑：src/utils/ffmpegCore.ts 从 /ffmpeg/ 同源加载 core，
// 31 MB 的 wasm 不进 git，统一由锁定版本的 npm 包提供。ffmpeg.worker.js 是手工内联版，仍随源码提交。

import { copyFileSync, mkdirSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const outDir = path.resolve(__dirname, "../public/ffmpeg")

let coreJs
let coreWasm
try {
  coreJs = require.resolve("@ffmpeg/core").replace(`${path.sep}umd${path.sep}`, `${path.sep}esm${path.sep}`)
  coreWasm = path.join(path.dirname(coreJs), "ffmpeg-core.wasm")
} catch {
  throw new Error("[tapcanvas] 缺少 @ffmpeg/core 依赖。请先在仓库根目录执行：pnpm install")
}

mkdirSync(outDir, { recursive: true })
copyFileSync(coreJs, path.join(outDir, "ffmpeg-core.js"))
copyFileSync(coreWasm, path.join(outDir, "ffmpeg-core.wasm"))
