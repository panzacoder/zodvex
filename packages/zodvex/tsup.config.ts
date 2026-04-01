import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/core/index.ts',
    'src/mini/index.ts',
    'src/server/index.ts',
    'src/transform/index.ts',
    'src/cli/index.ts',
    'src/codegen/index.ts',
    'src/react/index.ts',
    'src/client/index.ts',
    'src/form/mantine/index.ts',
  ],
  format: ['esm'],
  // DTS handled by tsc in build script - tsup's dts doesn't output individual files
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  minify: false,
  external: ['zod', 'convex', 'convex-helpers', 'bun', 'react', '@mantine/form', 'mantine-form-zod-resolver'],
  outDir: 'dist',
  target: 'node18'
})
