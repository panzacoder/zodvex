import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: {
    resolve: true,
    compilerOptions: {
      composite: false,
      noEmit: false
    }
  },
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