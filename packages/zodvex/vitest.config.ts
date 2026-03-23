import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['__tests__/**/*.test.ts'],
    // Codegen tests share a fixture directory — run files sequentially to avoid races.
    // The full suite is <2s so parallelism isn't needed.
    fileParallelism: false,
  },
})
