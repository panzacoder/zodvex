import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts'
  },
  format: ['esm'],
  target: 'node20',
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  shims: false
})
