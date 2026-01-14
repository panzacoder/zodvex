import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/transform/index.ts'],
  format: ['esm'],
  dts: {
    resolve: false,
    compilerOptions: {
      composite: false,
      noEmit: false,
      skipLibCheck: true
    }
  },
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  minify: false,
  external: ['zod', 'convex', 'convex-helpers'],
  outDir: 'dist',
  target: 'node18'
})
