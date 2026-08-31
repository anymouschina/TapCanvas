import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'path';
import { tablerDirectImports } from './vite/tablerDirectImports';

const imagePromptSpecEntry = resolve(__dirname, '../../packages/schemas/image-prompt-spec/index.js');

function requireStoragePublicBase(value: string | undefined, envKey: string): string {
  const normalized = value?.trim().replace(/\/+$/, '') ?? '';
  if (!normalized) throw new Error(`[tapcanvas] Missing \`${envKey}\`.`);
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(`[tapcanvas] \`${envKey}\` must be an absolute URL.`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`[tapcanvas] \`${envKey}\` must use HTTPS.`);
  return normalized;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createManualChunks(id: string): string | undefined {
  // React + Zustand 必须独立成 vendor chunk，避免 app-canvas 与 app-api 之间
  // 因 Rollup 将 React 分配给 app-canvas 而 app-api 又从 app-canvas 导入 React
  // 同时 app-canvas 导入 app-api，形成循环依赖导致 TDZ 黑屏。
  if (
    id.includes('/node_modules/react/')
    || id.includes('/node_modules/react-dom/')
    || id.includes('/node_modules/zustand/')
    || id.includes('/node_modules/use-sync-external-store/')
  ) {
    return 'vendor-react';
  }
  if (
    id.includes('/node_modules/@xyflow/') ||
    id.includes('/node_modules/@reactflow/')
  ) {
    return 'vendor-xyflow';
  }
  if (id.includes('/node_modules/framer-motion/')) {
    return 'vendor-framer';
  }
  if (id.includes('/node_modules/@mantine/')) {
    return 'vendor-mantine';
  }
  if (
    id.includes('/src/canvas/nodes/taskNode/ImageViewPreview3D')
    || id.includes('/src/canvas/nodes/taskNode/imageView3dMath')
    || id.includes('/node_modules/three/')
  ) {
    return 'image-view-editor-3d';
  }
  return undefined;
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const storageProvider = env.VITE_OBJECT_STORAGE_PROVIDER?.trim().toLowerCase();
  if (storageProvider !== 'tos' && storageProvider !== 'r2') {
    throw new Error('[tapcanvas] VITE_OBJECT_STORAGE_PROVIDER must be either tos or r2.');
  }
  const storagePublicBases = [
    requireStoragePublicBase(env.VITE_TOS_PUBLIC_BASE_URL, 'VITE_TOS_PUBLIC_BASE_URL'),
    requireStoragePublicBase(env.VITE_R2_PUBLIC_BASE_URL, 'VITE_R2_PUBLIC_BASE_URL'),
  ];
  const storageHostPattern = new RegExp(
    `^https://(?:${storagePublicBases.map((base) => escapeRegExp(new URL(base).hostname)).join('|')})(?:/|$)`,
  );

  if (command === 'build' && mode !== 'production') {
    throw new Error(
      `[tapcanvas] Dev build is disabled. Use \`vite build --mode production\` (current mode: ${mode}).`,
    );
  }

  if (command === 'build') {
    // 容器化/反代部署一等公民（2026-07-15 用户拍板）：缺省即相对自身 `/api`——静态服务
    // 同源反代到 api（dev proxy / Caddy / nginx 同构），镜像不烧域名、换环境零重建。
    // CF 等跨域部署仍由 CI vars 显式覆盖为绝对地址。
    const apiBase = (env.VITE_API_BASE || '').trim() || '/api';
    const githubClientId = (env.VITE_GITHUB_CLIENT_ID || '').trim();
    const githubRedirectUri = (env.VITE_GITHUB_REDIRECT_URI || '').trim();
    // GitHub 登录允许显式关闭：变量「写了但留空」= 有意禁用（前端按钮自动置灰，见
    // LoginForm/LoginOverlay 的 githubEnabled），「整个变量缺失」才是漏配 → 报错。
    // 二者靠 undefined vs '' 区分，所以这里必须查原始值，不能用上面 trim 过的空串。
    const githubClientIdDeclared = typeof env.VITE_GITHUB_CLIENT_ID === 'string';
    const githubRedirectUriDeclared = typeof env.VITE_GITHUB_REDIRECT_URI === 'string';
    if (!githubClientIdDeclared) {
      throw new Error(
        '[tapcanvas] Missing `VITE_GITHUB_CLIENT_ID` for production build. Set it in `apps/web/.env.production` (empty value = GitHub login disabled).',
      );
    }
    if (!githubRedirectUriDeclared) {
      throw new Error(
        '[tapcanvas] Missing `VITE_GITHUB_REDIRECT_URI` for production build. Set it in `apps/web/.env.production` (empty value = GitHub login disabled).',
      );
    }

    const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(?::|\/|$)/.test(apiBase);
    if (isLocalhost && process.env.ALLOW_LOCALHOST_IN_PROD_BUILD !== '1') {
      throw new Error(
        `[tapcanvas] Refusing to build with a localhost \`VITE_API_BASE\` in production mode: ${apiBase}. Set \`ALLOW_LOCALHOST_IN_PROD_BUILD=1\` to override.`,
      );
    }
    // 把（可能是缺省的）apiBase 回写到 env，确保 import.meta.env.VITE_API_BASE 在 bundle
    // 里拿到同一个值——否则缺省 '/api' 只过了校验、没进产物。
    process.env.VITE_API_BASE = apiBase;

    const redirectUriIsLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(?::|\/|$)/.test(githubRedirectUri);
    if (redirectUriIsLocalhost && process.env.ALLOW_LOCALHOST_IN_PROD_BUILD !== '1') {
      throw new Error(
        `[tapcanvas] Refusing to build with a localhost \`VITE_GITHUB_REDIRECT_URI\` in production mode: ${githubRedirectUri}. Set \`ALLOW_LOCALHOST_IN_PROD_BUILD=1\` to override.`,
      );
    }
  }

	  return {
	    plugins: [
	      react({
	        babel: {
	          plugins: [tablerDirectImports],
	        },
	      }),
      VitePWA({
        registerType: 'prompt',
        injectRegister: 'auto',
        workbox: {
          // The app has no offline navigation fallback, so the HTML entry must
          // always come from the server instead of a previous precache.
          globPatterns: [],
          navigateFallback: null,
          // Prompt mode sends SKIP_WAITING only after user confirmation. Claim
          // open clients after activation so Workbox emits `controlling` and
          // the registration hook can reload every stale page.
          clientsClaim: true,
          cleanupOutdatedCaches: true,
          // Keep enough CacheFirst entries for large multi-project canvases.
          // TOS-backed canvas shells use one of two stable width variants while
          // focused editors retain the original, so each logical image has a
          // small, bounded set of cache keys.
          runtimeCaching: [
            {
              urlPattern: /\/assets\/.*\.(?:js|css)$/,
              handler: 'CacheFirst' as const,
              options: {
                cacheName: 'app-assets-v1',
                expiration: { maxEntries: 120, maxAgeSeconds: 2592000 },
                cacheableResponse: { statuses: [200] },
              },
            },
            {
              urlPattern: storageHostPattern,
              handler: 'CacheFirst' as const,
              options: {
                cacheName: 'object-storage-assets-v1',
                expiration: { maxEntries: 10000, maxAgeSeconds: 2592000 },
                cacheableResponse: { statuses: [200] },
                rangeRequests: true,
              },
            },
            {
              urlPattern: /\.(?:png|jpg|jpeg|webp|svg|ico|avif|gif)$/,
              handler: 'CacheFirst' as const,
              options: {
                cacheName: 'static-images-v2',
                expiration: { maxEntries: 300, maxAgeSeconds: 2592000 },
                cacheableResponse: { statuses: [200] },
              },
            },
            {
              urlPattern: /\.(?:woff2?|ttf|otf|eot)$/,
              handler: 'CacheFirst' as const,
              options: {
                cacheName: 'fonts-v1',
                expiration: { maxEntries: 30, maxAgeSeconds: 31536000 },
                cacheableResponse: { statuses: [200] },
              },
            },
          ],
        },
        manifest: {
          name: 'TapCanvas Pro',
          short_name: 'TapCanvas',
          theme_color: '#1a1b1e',
          background_color: '#1a1b1e',
          display: 'browser',
        },
        devOptions: {
          enabled: false,
        },
      }),
    ],
	    resolve: {
	      extensions: ['.ts', '.tsx', '.mjs', '.js', '.mts', '.jsx', '.json'],
	      alias: {
	        // packages/schemas/* are aliased to raw source files. Those files live
	        // outside apps/web, so Node module resolution would start from
	        // packages/schemas/ and fail to find zod (which is installed under
	        // apps/web/node_modules). Pin the zod resolution to this app's
	        // node_modules so it works regardless of the alias target's location.
	        zod: resolve(__dirname, 'node_modules/zod'),
	        '@tapcanvas/canvas-plan-protocol': resolve(__dirname, '../../packages/schemas/canvas-plan-protocol/index.ts'),
	        '@tapcanvas/codex-task-protocol': resolve(__dirname, '../../packages/schemas/codex-task-protocol/index.ts'),
	        '@tapcanvas/chapter-canvas-intents': resolve(__dirname, '../../packages/schemas/chapter-canvas-intents/index.ts'),
	        '@tapcanvas/canvas-edge-semantics': resolve(__dirname, '../../packages/schemas/canvas-edge-semantics/index.ts'),
	        '@tapcanvas/character-bible-protocol': resolve(__dirname, '../../packages/schemas/character-bible-protocol/index.ts'),
	        '@tapcanvas/flow-anchor-bindings': resolve(__dirname, '../hono-api/src/modules/flow/flow.anchor-bindings.ts'),
	        '@tapcanvas/script-structure-protocol': resolve(__dirname, '../../packages/schemas/script-structure-protocol/index.ts'),
	        '@tapcanvas/shot-table-protocol': resolve(__dirname, '../../packages/schemas/shot-table-protocol/index.ts'),
	        '@tapcanvas/video-orchestrator-protocol': resolve(__dirname, '../../packages/schemas/video-orchestrator-protocol/index.ts'),
	        '@tapcanvas/workflow-kernel-protocol': resolve(__dirname, '../../packages/schemas/workflow-kernel-protocol/index.ts'),
	        '@tapcanvas/project-directory-protocol': resolve(__dirname, '../hono-api/src/modules/project-directory/project-directory.contract.ts'),
	        '@tapcanvas/storyboard-director-protocol': resolve(__dirname, '../../packages/schemas/storyboard-director-protocol/index.ts'),
	        '@tapcanvas/storyboard-selection-protocol': resolve(__dirname, '../../packages/schemas/storyboard-selection-protocol/index.ts'),
	        '@tapcanvas/storyboard-adventure-protocol': resolve(__dirname, '../../packages/schemas/storyboard-adventure-protocol/index.ts'),
	        '@tapcanvas/image-prompt-spec': imagePromptSpecEntry,
	        '@tapcanvas/image-view-controls': resolve(__dirname, '../../packages/schemas/image-view-controls/index.mjs'),
	        '@tapcanvas/image-operation-protocol': resolve(__dirname, '../../packages/schemas/image-operation-protocol/index.ts'),
	      },
	    },
	    optimizeDeps: {
	      include: ['@tapcanvas/image-prompt-spec', '@tapcanvas/image-view-controls'],
	      // This protocol is edited together with the canvas application. Keep it
	      // on Vite's source-module path so a running 5175 dev server never serves
	      // a stale pre-bundled export surface after the protocol changes.
	      exclude: ['@tabler/icons-react', '@tapcanvas/image-operation-protocol'],
	    },
	    server: {
	      port: 5175,
	      host: true,
	      fs: {
	        allow: [resolve(__dirname, '..'), resolve(__dirname, '../../packages')],
	      },
	      proxy: {
	        '/api': {
	          // 宿主机本地开发默认连接映射到 localhost:8788 的 API；Docker
	          // 部署必须显式设置 API_PROXY_TARGET=http://api:8788。
	          target: process.env.API_PROXY_TARGET || 'http://localhost:8788',
	          changeOrigin: true,
	          rewrite: (path) => path.replace(/^\/api/, ''),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.removeHeader('accept-encoding');
            });
          },
        },
        '/public': {
	          target: process.env.API_PROXY_TARGET || 'http://localhost:8788',
          changeOrigin: true,
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
      outDir: resolve(__dirname, 'dist'),
      emptyOutDir: true,
      commonjsOptions: {
        include: [/node_modules/, /packages\/schemas\/image-prompt-spec/],
        transformMixedEsModules: true,
      },
      modulePreload: { polyfill: false },
      rollupOptions: {
	        output: {
	          manualChunks: createManualChunks,
	        },
      },
    },
  };
});
