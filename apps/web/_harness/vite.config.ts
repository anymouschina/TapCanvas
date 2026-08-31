import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// 隔离调试用的干净 vite：无 PWA / 无 SPA 登录路由，仅渲染导演台 3D 视口
export default defineConfig({
  root: resolve(__dirname),
  publicDir: resolve(__dirname, '../public'),
  server: {
    port: 5199,
    fs: { allow: [resolve(__dirname, '..')] },
  },
  plugins: [react()],
})
