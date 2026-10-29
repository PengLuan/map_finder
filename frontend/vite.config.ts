import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3001,
    proxy: {
      // 本地后端端口 8010（避免与本机其他项目常驻的 8000 冲突），生产由 Nginx 代理不受影响
      '/api': {
        target: 'http://localhost:8010',
        changeOrigin: true,
      },
      '/static': {
        target: 'http://localhost:8010',
        changeOrigin: true,
      },
    },
  },
})
