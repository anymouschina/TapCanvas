import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig(({ command, mode }) => {
  if (command === 'build' && mode !== 'production') {
    throw new Error(
      `[tapcanvas] Dev build is disabled. Use \`vite build --mode production\` (current mode: ${mode}).`,
    );
  }

  if (command === 'build') {
    const env = loadEnv(mode, process.cwd(), 'VITE_');
    const apiBase = (env.VITE_API_BASE || '').trim();

    if (!apiBase) {
      throw new Error(
        '[tapcanvas] Missing `VITE_API_BASE` for production build. Set it via CI env vars or `apps/web/.env.production`.',
      );
    }

    const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(?::|\/|$)/.test(apiBase);
    if (isLocalhost && process.env.ALLOW_LOCALHOST_IN_PROD_BUILD !== '1') {
      throw new Error(
        `[tapcanvas] Refusing to build with a localhost \`VITE_API_BASE\` in production mode: ${apiBase}. Set \`ALLOW_LOCALHOST_IN_PROD_BUILD=1\` to override.`,
      );
    }
  }

  return {
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
              proxyReq.removeHeader('accept-encoding');
            });
          },
        },
      },
    },
    build: {
      // 输出到仓库根目录的 dist，方便与根 wrangler.toml 的 assets 配置对齐
      outDir: resolve(__dirname, '../../dist'),
      emptyOutDir: true,
    },
  };
});
