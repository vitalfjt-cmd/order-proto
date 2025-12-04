import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // NodeのpathやfileURLToPathを使わず、プロジェクトルート基準の絶対パスでOK
      '@': '/src',
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/ordering': { target: 'http://localhost:8080', changeOrigin: true },
      '/shipments': { target: 'http://localhost:8080', changeOrigin: true },
      '/vendor':   { target: 'http://localhost:8080', changeOrigin: true },
      '/master':   { target: 'http://localhost:8080', changeOrigin: true },
      // ★ これを追加
      "/inspections":  { target: 'http://localhost:8080', changeOrigin: true },
      // 互換
      '/stores':   { target: 'http://localhost:8080', changeOrigin: true },
      '/vendors':  { target: 'http://localhost:8080', changeOrigin: true },
      '/audit':  { target: 'http://localhost:8080', changeOrigin: true },
    }
  },
})
