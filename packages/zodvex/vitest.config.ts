import { defineConfig } from 'vitest/config'
import { zodToMiniPlugin } from '../zod-to-mini/src/vite-plugin'

export default defineConfig({
  test: {
    // Run the suite twice: once with full zod, once with zod aliased to zod/mini.
    // This validates compatibility with both variants from the same test code.
    //
    // Codegen tests (codegen-cli, codegen-e2e, codegen-generate) share a single fixture
    // directory (__tests__/fixtures/codegen-project) and write/delete files in it during
    // each test. Running those files in parallel causes races between afterEach cleanup
    // and the next test's writes. Disabling file-level parallelism is the simplest fix;
    // the full suite runs in ~7s so the cost is acceptable.
    //
    // If the suite grows significantly, consider migrating the codegen tests to isolated
    // temp directories (fs.mkdtempSync) and re-enabling fileParallelism here.
    projects: [
      {
        test: {
          name: 'zod',
          include: ['__tests__/**/*.test.ts'],
          fileParallelism: false,
        },
      },
      {
        test: {
          name: 'zod-mini',
          include: ['__tests__/**/*.test.ts'],
          fileParallelism: false,
        },
        plugins: [zodToMiniPlugin()],
        resolve: {
          alias: [
            // Exact-match alias: only the bare specifier 'zod' is rewritten to
            // 'zod/mini'. Subpath imports like 'zod/v4/core' and 'zod/mini' are
            // NOT affected because the regex anchors prevent prefix matching.
            { find: /^zod$/, replacement: 'zod/mini' },
          ],
        },
      },
    ],
  },
})
