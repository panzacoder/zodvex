import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/core/index.ts',
    'src/server/index.ts',
    'src/transform/index.ts',
  ],
  format: ['esm'],
  // DTS handled by tsc in build script - tsup's dts doesn't output individual files
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  minify: false,
  external: ['zod', 'convex', 'convex-helpers'],
  outDir: 'dist',
  target: 'node18'
})
