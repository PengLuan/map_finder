import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * 后台管理独立构建配置
 * - 入口: admin.html → src/admin-main.tsx
 * - 输出: dist-admin/
 * - 不包含前台游戏页面代码，包体更小
 * - 部署方式：独立子域名（如 https://map-admin.zhizhang.me）
 *
 * 构建: pnpm run build:admin
 * 部署: scp -P 11470 -r dist-admin/* root@server:/www/wwwroot/zhizhang/map/admin/dist/
 */
export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: 'dist-admin',
    rollupOptions: {
      input: {
        admin: 'admin.html',
      },
    },
  },
  server: {
    port: 3002,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/static': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
