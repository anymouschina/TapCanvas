import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "path";

// SPA 构建配置：用于部署到 Cloudflare Worker 静态站点（共用根目录 dist）
export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, __dirname, "VITE_");
	const apiBaseRaw = (env.VITE_API_BASE || "http://localhost:8788").trim();
	const apiOrigin = (() => {
		try {
			return new URL(apiBaseRaw).origin;
		} catch {
			return "http://localhost:8788";
		}
	})();

	return {
	plugins: [vue()],
	resolve: {
		alias: {
			"@": resolve(__dirname, "src"),
		},
	},
	// 让 Vite 从当前包目录读取 .env（非仓库根）
	envDir: __dirname,
	build: {
		// 将产物输出到仓库根目录下的 dist，方便与根 wrangler.toml 的 assets 目录对齐
		outDir: resolve(__dirname, "../../dist"),
		emptyOutDir: true,
		sourcemap: true,
	},
	server: {
		host: true,
		port: 5174,
		proxy: {
			// Make `/assets/*` available on the WebCut origin in local dev
			// so the embed clipper can load `/assets/proxy-video?...` with auth headers.
			"/assets": {
				target: apiOrigin,
				changeOrigin: true,
			},
			"/auth": {
				target: apiOrigin,
				changeOrigin: true,
			},
		},
	},
	};
});
