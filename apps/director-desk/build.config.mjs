// 构建产物目录的单一真源：vite.config.ts 与 scripts/check-release-privacy.mjs 都从这里读取，
// 避免出现两处字面量不一致时隐私检查扫错目录。
// 相对 apps/director-desk 解析：产物直接落到 Web 的 public/ 下，由 Web 的 dev / build 统一分发。
export const OUT_DIR = '../web/public/director-desk';
