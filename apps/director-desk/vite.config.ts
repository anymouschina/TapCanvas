import { defineConfig } from 'vite';
import { OUT_DIR } from './build.config.mjs';

// 导演台以静态子应用的形式嵌入 TapCanvas Web：Web 端通过同源 iframe 加载 /director-desk/，
// 因此 base 固定为该子路径，构建产物落到 apps/web/public/ 下。
// outDir 位于 root 之外，必须显式开启 emptyOutDir。
export default defineConfig({
  base: '/director-desk/',
  build: {
    outDir: OUT_DIR,
    emptyOutDir: true,
  },
});
