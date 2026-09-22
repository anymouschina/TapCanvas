// 把 vendored 的导演台（apps/director-desk）构建到 web 的 public/director-desk/。
// 在 predev / prebuild 自动跑：Web 端通过同源 iframe 加载该目录，产物缺失时画布里的导演台
// 节点会打开一个 404 页面，因此这里必须让 Web 构建显式失败，而不是静默跳过。

import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const deskDir = path.resolve(__dirname, "../../director-desk")

if (!existsSync(path.join(deskDir, "package.json"))) {
  throw new Error(
    `[tapcanvas] 导演台源码缺失：${deskDir}。apps/web 依赖 apps/director-desk 才能构建。`,
  )
}

if (!existsSync(path.join(deskDir, "node_modules"))) {
  throw new Error(
    "[tapcanvas] 导演台依赖未安装。请先执行：npm --prefix apps/director-desk install",
  )
}

execFileSync("npm", ["run", "build"], { cwd: deskDir, stdio: "inherit" })
