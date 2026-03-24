import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['__tests__/**/*.test.ts'],
    // Codegen tests (codegen-cli, codegen-e2e, codegen-generate) share a single fixture
    // directory (__tests__/fixtures/codegen-project) and write/delete files in it during
    // each test. Running those files in parallel causes races between afterEach cleanup
    // and the next test's writes. Disabling file-level parallelism is the simplest fix;
    // the full suite runs in ~7s so the cost is acceptable.
    //
    // If the suite grows significantly, consider migrating the codegen tests to isolated
    // temp directories (fs.mkdtempSync) and re-enabling fileParallelism here.
    fileParallelism: false,
  },
})
