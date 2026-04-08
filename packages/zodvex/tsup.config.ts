import { defineConfig } from 'tsup'
import type { Plugin } from 'esbuild'

const shared = {
  format: ['esm'] as const,
  // DTS handled by tsc in build script - tsup's dts doesn't output individual files
  dts: false,
  splitting: false,
  sourcemap: true,
  treeshake: true,
  minify: false,
  target: 'node18' as const,
}

const external = ['zod', 'zod/v4/core', 'convex', 'convex-helpers', 'bun', 'react', '@mantine/form', 'mantine-form-zod-resolver', 'ts-morph']

/**
 * esbuild plugin that rewrites `import ... from 'zod'` to `import ... from 'zod/mini'`
 * for the mini entrypoint build. Source code keeps `import { z } from 'zod'` unchanged —
 * the aliasing happens only in the built output.
 */
const zodMiniAliasPlugin: Plugin = {
  name: 'alias-zod-to-mini',
  setup(build) {
    build.onResolve({ filter: /^zod$/ }, () => ({
      path: 'zod/mini',
      external: true,
    }))
  },
}

export default defineConfig([
  // All entrypoints except mini — standard build with 'zod' as external
  {
    ...shared,
    entry: [
      'src/index.ts',
      'src/core/index.ts',
      'src/legacy/index.ts',
      'src/server/index.ts',
      'src/cli/index.ts',
      'src/codegen/index.ts',
      'src/react/index.ts',
      'src/client/index.ts',
      'src/form/mantine/index.ts',
      'src/labs/index.ts',
    ],
    external,
    outDir: 'dist',
    clean: true,
  },
  // Mini entrypoint — 'zod' imports rewritten to 'zod/mini' at build time.
  // noExternal prevents tsup from auto-externalizing 'zod' so the esbuild
  // plugin can intercept and redirect it.
  {
    ...shared,
    entry: {
      'mini/index': 'src/mini/index.ts',
      'mini/client/index': 'src/mini/client/index.ts',
      'mini/react/index': 'src/mini/react/index.ts',
      'mini/server/index': 'src/mini/server/index.ts',
    },
    external: [...external.filter(e => e !== 'zod'), 'zod/mini'],
    noExternal: [/^zod$/],
    esbuildPlugins: [zodMiniAliasPlugin],
    outDir: 'dist',
    clean: false,
  },
])
