console.error(`
ERROR: Do not use "bun test" directly.
Use "bun run test" instead, which runs vitest.

"bun test" uses Bun's built-in runner which does not support vitest APIs.
`)
process.exit(1)
