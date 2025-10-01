import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['index.ts'],
  format: ['cjs', 'esm'],
  dts: false, // Disabled - types are consumed directly from .ts files
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  minify: false,
  external: ['zod', 'convex', 'convex-helpers'],
  outDir: 'dist',
  target: 'node18',
  esbuildOptions(options) {
    options.banner = {
      js: '"use strict";'
    }
  }
})