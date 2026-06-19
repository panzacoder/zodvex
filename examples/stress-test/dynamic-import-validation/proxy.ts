// Fast LOCAL heap proxy (no Convex). Dynamically import()s K of N generated
// model modules in this process and reports heap growth. JS module systems
// (Bun/Node) defer ESM evaluation until import(), so heap should scale with K
// — a quick confidence signal for the mechanism before spending real deploys.
//
// NOT a substitute for the real-deploy sweep: this is plain Bun/Node, not
// Convex's V8 isolate. It validates the *deferred-evaluation* premise, not the
// Convex runtime behavior. Use sweep.ts --mode=dynamic for the authoritative test.
//
// Run: bun run proxy.ts --models=750 [--subset=1,10,50,100,200,350,500,750]

import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { generate } from './generate.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

function forceGc(): void {
  // Bun and Node expose GC differently; try both, no-op if neither.
  const b = (globalThis as { Bun?: { gc?: (full: boolean) => void } }).Bun
  if (b?.gc) b.gc(true)
  const g = (globalThis as { gc?: () => void }).gc
  if (g) g()
}

function heapMB(): number {
  forceGc()
  return process.memoryUsage().heapUsed / 1024 / 1024
}

const args = process.argv.slice(2)
const get = (k: string, d?: string) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d
const models = parseInt(get('models', '750')!)
const subset = get('subset')
  ? get('subset')!.split(',').map(Number)
  : [1, 10, 50, 100, 200, 350, 500, 750]

const out = join(__dirname, '.out', 'proxy')
generate({ models, mode: 'dynamic', outDir: out })

const checkpoints = new Set(subset.filter((k) => k <= models))
const max = Math.min(Math.max(...subset), models)

const before = heapMB()
console.log(`models generated: ${models} · baseline heap: ${before.toFixed(1)} MB`)
console.log(`(plain Bun/Node proxy — confirms deferred eval; not Convex's isolate)\n`)

const sink: unknown[] = []
for (let i = 0; i < max; i++) {
  const mod = await import(join(out, 'models', `model_${String(i).padStart(4, '0')}.ts`))
  for (const k of Object.keys(mod)) sink.push((mod as Record<string, unknown>)[k])
  const loaded = i + 1
  if (checkpoints.has(loaded)) {
    const h = heapMB()
    const delta = h - before
    console.log(
      `  imported ${String(loaded).padStart(4)}/${models}: heap ${h.toFixed(1)} MB ` +
        `(+${delta.toFixed(1)} MB, ${((delta / loaded) * 1000).toFixed(0)} KB/model)`,
    )
  }
}
;(globalThis as Record<string, unknown>).__divSink = sink
console.log(`\nIf KB/model stays roughly flat and heap tracks K (not ${models}),`)
console.log(`the unimported models cost nothing — the premise holds.`)
