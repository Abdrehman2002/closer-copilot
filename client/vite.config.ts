import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(root, './src') } },
  build: { outDir: '../public', emptyOutDir: true },
  server: {
    proxy: {
      '/api': 'http://localhost:7801',
      '/simulate': 'http://localhost:7801',
      '/events': { target: 'ws://localhost:7801', ws: true },
      '/audio': { target: 'ws://localhost:7801', ws: true },
    },
  },
})
