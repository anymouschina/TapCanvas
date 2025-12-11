import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "path";

// SPA 构建配置：用于部署到 Cloudflare Worker 静态站点（dist-app）
export default defineConfig({
	plugins: [vue()],
	resolve: {
		alias: {
			"@": resolve(__dirname, "src"),
		},
	},
	build: {
		outDir: "dist-app",
		emptyOutDir: true,
		sourcemap: true,
	},
	server: {
		host: true,
		port: 5174,
	},
});
