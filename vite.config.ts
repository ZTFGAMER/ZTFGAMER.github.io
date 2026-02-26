import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  server: {
    host: '0.0.0.0', // 局域网手机调试
    port: 5173,
    hmr: {
      host: 'localhost', // 桌面浏览器 HMR 走 localhost，手机调试不受影响
      port: 5173,
    },
  },
})
