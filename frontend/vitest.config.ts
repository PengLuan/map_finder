import { defineConfig } from 'vitest/config'

// 提示系统纯逻辑单元测试配置：仅运行 src/utils 下的 .test.ts 文件
// 不加载 React / Leaflet，避免 DOM 依赖
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
})
