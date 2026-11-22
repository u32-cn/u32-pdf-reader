import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))

await build({
  entryPoints: [
    path.join(root, 'src/main/main.ts'),
    path.join(root, 'src/main/preload.ts'),
  ],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
  outdir: path.join(root, 'dist/main'),
  entryNames: '[name]',
  outExtension: { '.js': '.cjs' },
  sourcemap: true,
})
console.log('main build ok')
