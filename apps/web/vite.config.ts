import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
  },
  build: {
    // 输出到仓库根目录的 dist，方便与根 wrangler.toml 的 assets 配置对齐
    outDir: resolve(__dirname, '../../dist'),
    emptyOutDir: true,
  },
});
