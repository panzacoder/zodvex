// Generator for the dynamic-import memory-validation experiment (Ian's ask:
// "see if doing dynamic imports in actions avoids memory limits when only
// dynamically importing a subset").
//
// Emits a self-contained convex/ tree:
//   <outDir>/
//     models/model_NNNN.ts   — N copies of the real zodvex seed models
//                              (heavy schemas, ~the real per-model eval cost)
//     dynImport.ts           — the action under test
//   (no schema.ts — the action never touches ctx.db, so we keep the deploy
//    minimal and avoid assembling every model into one schema isolate)
//
// Two action shapes:
//   - 'dynamic': loadSubset(count) dynamically import()s the first `count`
//     models. Each import is a STATIC-specifier dynamic import, so Convex
//     stores each model as its own module, the analyzer does NOT follow them,
//     and a model is only evaluated when its loader is awaited at runtime.
//   - 'static': loadEager statically imports ALL N models at module top level
//     — the eager baseline that pays every model's eval cost up front (and
//     OOMs the analyzer at high N, exactly like today's q/m static graph).

import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'fs'
import { join, basename, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SEEDS_DIR = join(__dirname, '..', 'seeds', 'zodvex', 'models')

export type Mode = 'dynamic' | 'static'

interface Seed {
  name: string
  source: string
  tableName: string
}

function loadSeeds(): Seed[] {
  return readdirSync(SEEDS_DIR)
    .filter((f) => f.endsWith('.ts'))
    .sort()
    .map((f) => {
      const source = readFileSync(join(SEEDS_DIR, f), 'utf-8')
      const tableName =
        source.match(/defineZodModel\(\s*'([^']+)'/)?.[1] ?? `${basename(f, '.ts')}s`
      return { name: basename(f, '.ts'), source, tableName }
    })
}

const padName = (i: number) => `model_${String(i).padStart(4, '0')}`

/**
 * Stamp a unique copy of a seed model. Gives each copy a unique table name
 * (so zodvex's per-name registration never collides across the N modules) and
 * inlines the `process.env.ZODVEX_SLIM` default — Convex's analyzer forbids
 * process.env access at module-init time.
 */
function stampModel(seed: Seed, idx: number): string {
  const suffix = String(idx).padStart(4, '0')
  const uniqueTable = `${seed.tableName}_${suffix}`
  let out = seed.source.replaceAll(`'${seed.tableName}'`, `'${uniqueTable}'`)
  out = out.replace(/const opts = process\.env\.ZODVEX_SLIM[^\n]*\n/, 'const opts = undefined\n')
  return out
}

function dynamicActionSource(n: number): string {
  const loaders = Array.from(
    { length: n },
    (_, i) => `  () => import('./models/${padName(i)}'),`,
  ).join('\n')
  return `import { actionGeneric as action } from 'convex/server'
import { v } from 'convex/values'

// IMPORTANT: this is a V8 action (NO "use node"). It runs in the same isolate
// environment as queries/mutations — Convex already enables dynamic import()
// here — so it is the faithful proxy for what enabling import() in q/m would do.
//
// Each loader is a static-specifier dynamic import; Convex stores each model as
// its own module and the analyzer does not follow them. A model is evaluated
// ONLY when its loader is awaited at runtime.
const loaders: Array<() => Promise<unknown>> = [
${loaders}
]

export const loadSubset = action({
  args: { count: v.number() },
  returns: v.object({ requested: v.number(), evaluated: v.number() }),
  handler: async (_ctx, { count }) => {
    const n = Math.max(0, Math.min(count, loaders.length))
    const sink: unknown[] = []
    for (let i = 0; i < n; i++) {
      const mod = await loaders[i]()
      // Touch every export so the module is genuinely evaluated (defeats DCE).
      for (const k of Object.keys(mod as object)) sink.push((mod as Record<string, unknown>)[k])
    }
    ;(globalThis as Record<string, unknown>).__divSink = sink
    return { requested: count, evaluated: n }
  },
})
`
}

function staticActionSource(n: number): string {
  const imports = Array.from(
    { length: n },
    (_, i) => `import * as m${i} from './models/${padName(i)}'`,
  ).join('\n')
  const refs = Array.from({ length: n }, (_, i) => `m${i}`).join(', ')
  return `import { actionGeneric as action } from 'convex/server'
import { v } from 'convex/values'

// EAGER baseline: statically imports all ${n} models at module top level, so
// every model is evaluated when this module is analyzed/loaded. This is the
// cost dynamic import is meant to avoid; at high N it OOMs the analyzer.
${imports}

const all = [${refs}]
;(globalThis as Record<string, unknown>).__divAll = all

export const loadEager = action({
  args: {},
  returns: v.object({ evaluated: v.number() }),
  handler: async () => ({ evaluated: all.length }),
})
`
}

export function generate(opts: { models: number; mode: Mode; outDir: string }): void {
  const { models, mode, outDir } = opts
  const seeds = loadSeeds()
  if (seeds.length === 0) throw new Error(`no zodvex seed models found at ${SEEDS_DIR}`)

  if (existsSync(outDir)) rmSync(outDir, { recursive: true })
  const modelsDir = join(outDir, 'models')
  mkdirSync(modelsDir, { recursive: true })

  for (let i = 0; i < models; i++) {
    const seed = seeds[i % seeds.length]
    writeFileSync(join(modelsDir, `${padName(i)}.ts`), stampModel(seed, i))
  }

  const action = mode === 'dynamic' ? dynamicActionSource(models) : staticActionSource(models)
  writeFileSync(join(outDir, 'dynImport.ts'), action)
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify({ models, mode }, null, 2))
}

// CLI: bun run generate.ts --models=750 --mode=dynamic [--out=DIR]
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const get = (k: string, d?: string) =>
    args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d
  const models = parseInt(get('models', '750')!)
  const mode = get('mode', 'dynamic') as Mode
  const outDir = get('out', join(__dirname, '.out', mode))!
  generate({ models, mode, outDir })
  console.log(`Generated ${models} models + ${mode} action at ${outDir}`)
}
