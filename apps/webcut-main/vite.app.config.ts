import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "path";

// SPA 构建配置：用于部署到 Cloudflare Worker 静态站点（共用根目录 dist）
export default defineConfig({
	plugins: [vue()],
	resolve: {
		alias: {
			"@": resolve(__dirname, "src"),
		},
	},
	build: {
		// 将产物输出到仓库根目录下的 dist，方便与根 wrangler.toml 的 assets 目录对齐
		outDir: resolve(__dirname, "../../dist"),
		emptyOutDir: true,
		sourcemap: true,
	},
	server: {
		host: true,
		port: 5174,
	},
});
