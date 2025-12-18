import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: 'http://api:8788',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.removeHeader('accept-encoding')
          })
        },
      },
    },
  },
  build: {
    // 输出到仓库根目录的 dist，方便与根 wrangler.toml 的 assets 配置对齐
    outDir: resolve(__dirname, '../../dist'),
    emptyOutDir: true,
  },
});
