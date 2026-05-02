/**
 * Heap-proxy measurement helper. Loaded as a `bun -e`-style subprocess by
 * stress-test.ts to estimate the push-time isolate footprint locally —
 * faster than a real Convex push, used as a binary-search SEED only. The
 * stress-test runner always confirms the proxy's candidate ceiling with a
 * real `convex deploy` push before reporting it.
 *
 * Usage: `bun --expose-gc run measureHeap.ts --dir=<path>`
 */
import { existsSync, readdirSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const dirArg = args.find(a => a.startsWith('--dir='))?.split('=')[1]
  if (!dirArg) {
    console.error('--dir=<path> is required')
    process.exit(1)
  }
  // Bun's dynamic import treats `'convex/schema.ts'` as a bare specifier and
  // tries to resolve it as a package. We need a file: URL or an absolute
  // ./path-prefixed string.
  const dir = isAbsolute(dirArg) ? dirArg : resolve(process.cwd(), dirArg)

  const gc = (globalThis as { gc?: () => void }).gc
  if (gc) {
    gc()
    gc()
  }
  const before = process.memoryUsage().heapUsed

  // Load every entrypoint file Convex would push: schema.ts at the convex
  // root, the monolithic endpoints.ts (legacy layout), and every file under
  // `models/` and `endpoints/` (per-file layout). Importing each
  // individually mimics how Convex's per-file analysis loads them — though
  // here we sum into a single Node heap, so this is a pessimistic upper
  // bound rather than a per-file budget. Single-file OOM is the limit
  // worth tracking under the new Convex backend.
  const candidates: string[] = [`${dir}/schema.ts`, `${dir}/endpoints.ts`]
  for (const sub of ['models', 'endpoints']) {
    const subDir = `${dir}/${sub}`
    if (!existsSync(subDir)) continue
    for (const entry of readdirSync(subDir)) {
      if (entry.endsWith('.ts')) candidates.push(`${subDir}/${entry}`)
    }
  }
  for (const p of candidates) {
    if (existsSync(p)) await import(pathToFileURL(p).href)
  }

  if (gc) {
    gc()
    gc()
  }
  const after = process.memoryUsage().heapUsed
  const heapDeltaMB = (after - before) / 1024 / 1024
  process.stdout.write(JSON.stringify({ heapDeltaMB }))
}

main().catch(err => {
  process.stderr.write(`measureHeap failed: ${(err as Error).message}\n`)
  process.exit(2)
})
