/**
 * This file exists solely to block `bun test` with a clear error.
 * Bun's built-in test runner does not support vitest APIs.
 * Always use `bun run test` instead.
 */
throw new Error(
  '\n\nERROR: Do not use "bun test" directly.\n' +
    'Use "bun run test" instead, which runs vitest.\n\n' +
    '"bun test" uses Bun\'s built-in runner which does not support vitest APIs.\n'
)
