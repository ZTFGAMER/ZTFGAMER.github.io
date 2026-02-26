import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  test: {
    environment: 'node',   // 逻辑层测试无需 DOM
    include: ['src/**/*.test.ts'],
    reporters: ['verbose'],
  },
})
