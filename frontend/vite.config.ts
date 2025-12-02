// import { defineConfig } from 'vite'
// import react from '@vitejs/plugin-react'
// import tailwindcss from '@tailwindcss/vite'
// import tsconfigPaths from 'vite-tsconfig-paths'

// export default defineConfig({
//   plugins: [react(), tailwindcss(), tsconfigPaths()],
// })

// import { defineConfig } from 'vite'
// import react from '@vitejs/plugin-react'
// import tailwindcss from '@tailwindcss/vite'
// import path from 'node:path'

// export default defineConfig({
//   plugins: [react(), tailwindcss()],
//   resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
// })

// import { defineConfig } from 'vite'
// import react from '@vitejs/plugin-react'
// import tailwindcss from '@tailwindcss/vite'
// import { fileURLToPath } from 'node:url'

// export default defineConfig({
//   plugins: [react(), tailwindcss()],
//   resolve: {
//     alias: {
//       '@': fileURLToPath(new URL('./src', import.meta.url)),
//     },
//   },
// })

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
      // "/items": "http://localhost:8080",
      // "/ordering": "http://localhost:8080",
      // "/stores": "http://localhost:8080",
      // "/vendors": "http://localhost:8080",
      // "/pricing": "http://localhost:8080" 
      
      // バックエンド: http://localhost:8080 へ中継
      // '/ordering': 'http://localhost:8080',
      // '/shipments': 'http://localhost:8080',
      // '/vendor': 'http://localhost:8080',
      // '/master': 'http://localhost:8080',

      '/ordering': { target: 'http://localhost:8080', changeOrigin: true },
      '/shipments': { target: 'http://localhost:8080', changeOrigin: true },
      '/vendor':   { target: 'http://localhost:8080', changeOrigin: true },
      '/master':   { target: 'http://localhost:8080', changeOrigin: true },
      // ★ これを追加
      "/inspections":  { target: 'http://localhost:8080', changeOrigin: true },
      // 互換
      '/stores':   { target: 'http://localhost:8080', changeOrigin: true },
      '/vendors':  { target: 'http://localhost:8080', changeOrigin: true },
    }
  },
})
