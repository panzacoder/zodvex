import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    react: 'src/react.ts'
  },
  format: ['esm'],
  target: 'node20',
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  external: ['react', 'convex', 'convex/react', 'convex/browser']
})
