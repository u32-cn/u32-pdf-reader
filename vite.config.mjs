import { defineConfig } from 'vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  base: './',
  root: path.join(root, 'src/renderer'),
  server: { port: 5173 },
  build: {
    outDir: path.join(root, 'dist/renderer'),
    emptyOutDir: true,
  },
})
