// Per-endpoint bundle + heap benchmark.
//
// For a given flavor and endpoint count:
//   1. compose() — write a runnable convex/ tree using flavor-specific seeds
//   2. bundleEntry() per endpoint — esbuild with Convex's isolate config
//   3. measureBundle() per bundle — spawn isolated node, measure heap on load
//
// Outputs per-endpoint distribution (min, p50, p95, max) plus aggregate stats.
// No Convex deploy. Fast iteration loop; ground truth on bundle bytes + heap.

import { mkdirSync, writeFileSync, existsSync, rmSync } from 'fs'
import { join, basename, dirname } from 'path'
import { fileURLToPath } from 'url'
import { compose, type Flavor } from './compose.js'
import { bundleEntry } from './bundle.js'
import { measureBundle, type MeasureResult } from './measureBundle.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

interface EndpointMetric {
  endpoint: string
  bundleBytes: number
  entryBytes: number
  chunkBytes: number
  chunks: number
  bundleTimeMs: number
  heapDeltaMB: number
  rssAfterMB: number
  ok: boolean
  oom: boolean
  error: string | null
}

interface BenchResult {
  flavor: Flavor
  count: number
  fanIn: number
  registry: boolean
  registryMode: 'static' | 'lazy' | 'invisible'
  lazyTables: boolean
  shape: 'harness' | 'explicit' | 'consolidated'
  models: number
  endpointsBenched: number
  endpointsOk: number
  endpointsFailed: number
  endpointsOOM: number
  bundleBytes: Stats
  heapDeltaMB: Stats
  rssMB: Stats
  /** schema.ts measured separately — relevant under lazy-tables. null = not measured. */
  schemaBundleBytes: number | null
  schemaHeapDeltaMB: number | null
  bundleTimeMs: number
  totalTimeMs: number
  perEndpoint: EndpointMetric[]
}

interface Stats { min: number; p50: number; p95: number; max: number; mean: number; sum: number }

function stats(xs: number[]): Stats {
  if (xs.length === 0) return { min: 0, p50: 0, p95: 0, max: 0, mean: 0, sum: 0 }
  const sorted = [...xs].sort((a, b) => a - b)
  const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]
  const sum = sorted.reduce((a, b) => a + b, 0)
  return {
    min: sorted[0],
    p50: pick(0.5),
    p95: pick(0.95),
    max: sorted[sorted.length - 1],
    mean: +(sum / sorted.length).toFixed(2),
    sum,
  }
}

export interface BenchOptions {
  flavor: Flavor
  count: number
  /** Cross-table imports per endpoint. Default 0. */
  fanIn?: number
  /** Each endpoint imports a registry.ts referencing every model. Default false. */
  registry?: boolean
  /** zodvex consumer shape to compose — see ComposeConfig.shape. Default 'harness'. */
  shape?: 'harness' | 'explicit' | 'consolidated'
  /** Model (table) count, decoupled from endpoint count — see ComposeConfig.models. */
  models?: number
  /** Registry consumer pattern. Default 'static'. */
  registryMode?: 'static' | 'lazy' | 'invisible'
  /**
   * For zodvex flavors: emit schema.ts in the lazy-tables shape and run
   * zodvex codegen so `_zodvex/tables.ts` exists. Use this to measure the
   * schema-eval ceiling under the schema-only-thin pattern.
   */
  lazyTables?: boolean
  /** Sample at most N endpoints (random / first-N). Default: all. */
  sample?: number
  /** Concurrency for measure subprocesses. Default 4. */
  concurrency?: number
  /** Hard cap heap in MB for each child. Omit to leave node default. */
  capMB?: number
  /** Workdir for composed code + bundles. Default: ./tmp/<flavor>. */
  workDir?: string
  /** Keep workDir on exit. Default: false. */
  keep?: boolean
  /** Log progress. Default: true. */
  verbose?: boolean
}

export async function bench(opts: BenchOptions): Promise<BenchResult> {
  const {
    flavor, count,
    fanIn = 0,
    registry = false,
    registryMode = 'static',
    lazyTables = false,
    shape = 'harness',
    models,
    sample,
    concurrency = 4,
    capMB,
    workDir = join(__dirname, 'tmp', flavor),
    keep = false,
    verbose = true,
  } = opts

  const startedAt = Date.now()
  const composedDir = join(workDir, 'composed')
  const bundlesRoot = join(workDir, 'bundles')

  if (existsSync(workDir)) rmSync(workDir, { recursive: true })
  mkdirSync(workDir, { recursive: true })

  const variantLabel = `${flavor}${fanIn ? ` fanin=${fanIn}` : ''}${registry ? ` registry/${registryMode}` : ''}${lazyTables ? ' lazy-tables' : ''}${shape !== 'harness' ? ` shape=${shape}` : ''}${models !== undefined && models !== count ? ` models=${models}` : ''}`
  if (verbose) console.error(`[${variantLabel}] composing ${count} endpoints…`)
  const composed = compose({ flavor, count, models, fanIn, registry, registryMode, lazyTables, shape, outputDir: composedDir })

  let entries = composed.endpointFiles
  if (sample && sample < entries.length) entries = entries.slice(0, sample)

  if (verbose) console.error(`[${variantLabel}] bundling ${entries.length} entries…`)
  const bundleStart = Date.now()
  const bundles: { entry: string; bundle: string; entryBytes: number; chunkBytes: number; chunks: number; bundleTimeMs: number }[] = []

  for (const entry of entries) {
    const name = basename(entry, '.ts')
    const outDir = join(bundlesRoot, name)
    try {
      const r = await bundleEntry({ entry, outDir, outbase: composedDir })
      bundles.push({
        entry,
        bundle: r.entryFile,
        entryBytes: r.entryBytes,
        chunkBytes: r.chunkBytes,
        chunks: r.chunkFiles.length,
        bundleTimeMs: r.bundleTimeMs,
      })
    } catch (err) {
      if (verbose) console.error(`[${variantLabel}] bundle FAILED for ${name}: ${(err as Error).message}`)
      bundles.push({ entry, bundle: '', entryBytes: 0, chunkBytes: 0, chunks: 0, bundleTimeMs: 0 })
    }
  }
  const bundleTimeMs = Date.now() - bundleStart

  if (verbose) console.error(`[${variantLabel}] measuring ${bundles.length} bundles (concurrency=${concurrency})…`)

  const metrics: EndpointMetric[] = []
  let inflight = 0
  let idx = 0

  await new Promise<void>((resolve) => {
    const launch = () => {
      while (inflight < concurrency && idx < bundles.length) {
        const b = bundles[idx++]
        inflight++
        const name = basename(b.entry, '.ts')

        const finalize = (m: MeasureResult | null, err?: string) => {
          inflight--
          metrics.push({
            endpoint: name,
            bundleBytes: b.entryBytes + b.chunkBytes,
            entryBytes: b.entryBytes,
            chunkBytes: b.chunkBytes,
            chunks: b.chunks,
            bundleTimeMs: b.bundleTimeMs,
            heapDeltaMB: m?.heapDeltaMB ?? 0,
            rssAfterMB: m?.rssAfterMB ?? 0,
            ok: !!m?.ok,
            oom: !!m?.oom,
            error: err ?? m?.error ?? null,
          })
          if (idx >= bundles.length && inflight === 0) resolve()
          else launch()
        }

        if (!b.bundle) { finalize(null, 'bundle failed'); continue }
        measureBundle({ bundle: b.bundle, maxOldSpaceMB: capMB })
          .then((r) => finalize(r))
          .catch((e) => finalize(null, (e as Error).message))
      }
    }
    launch()
  })

  metrics.sort((a, b) => a.endpoint.localeCompare(b.endpoint))

  // Schema.ts gets its own measurement so we can quantify the schema-eval
  // ceiling separately from per-endpoint heap. Convex analyzes schema.ts
  // in a distinct isolate at deploy time.
  const schemaPath = join(composedDir, 'schema.ts')
  let schemaBundleBytes: number | null = null
  let schemaHeapDeltaMB: number | null = null
  if (existsSync(schemaPath)) {
    if (verbose) console.error(`[${variantLabel}] measuring schema.ts…`)
    try {
      const r = await bundleEntry({
        entry: schemaPath,
        outDir: join(bundlesRoot, '_schema'),
        outbase: composedDir,
      })
      schemaBundleBytes = r.entryBytes + r.chunkBytes
      const measured = await measureBundle({ bundle: r.entryFile, maxOldSpaceMB: capMB })
      if (measured.ok) schemaHeapDeltaMB = measured.heapDeltaMB
      else if (verbose) console.error(`[${variantLabel}] schema load failed: ${measured.error}`)
    } catch (err) {
      if (verbose) console.error(`[${variantLabel}] schema bundle failed: ${(err as Error).message}`)
    }
  }

  const ok = metrics.filter(m => m.ok)
  const failed = metrics.filter(m => !m.ok && !m.oom)
  const oom = metrics.filter(m => m.oom)

  const result: BenchResult = {
    flavor,
    count,
    fanIn,
    registry,
    registryMode,
    lazyTables,
    shape,
    models: models ?? count,
    endpointsBenched: metrics.length,
    endpointsOk: ok.length,
    endpointsFailed: failed.length,
    endpointsOOM: oom.length,
    bundleBytes: stats(metrics.map(m => m.bundleBytes)),
    heapDeltaMB: stats(ok.map(m => m.heapDeltaMB)),
    rssMB: stats(ok.map(m => m.rssAfterMB)),
    schemaBundleBytes,
    schemaHeapDeltaMB,
    bundleTimeMs,
    totalTimeMs: Date.now() - startedAt,
    perEndpoint: metrics,
  }

  if (!keep) rmSync(workDir, { recursive: true })
  return result
}

function fmtBytes(b: number): string {
  if (b >= 1024 * 1024) return `${(b / 1024 / 1024).toFixed(2)} MB`
  if (b >= 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${b} B`
}

function printSummary(r: BenchResult) {
  const status = `${r.endpointsOk}/${r.endpointsBenched} ok` +
    (r.endpointsFailed ? ` · ${r.endpointsFailed} fail` : '') +
    (r.endpointsOOM ? ` · ${r.endpointsOOM} OOM` : '')
  const tags = `${r.fanIn ? ` fanin=${r.fanIn}` : ''}${r.registry ? ` registry/${r.registryMode}` : ''}${r.lazyTables ? ' lazy-tables' : ''}${r.shape !== 'harness' ? ` shape=${r.shape}` : ''}${r.models !== r.count ? ` models=${r.models}` : ''}`
  console.log(`\n=== ${r.flavor}${tags} @ count=${r.count} (${status}) ===`)
  console.log(`endpoints  bundle min/p50/p95/max:  ${fmtBytes(r.bundleBytes.min)} / ${fmtBytes(r.bundleBytes.p50)} / ${fmtBytes(r.bundleBytes.p95)} / ${fmtBytes(r.bundleBytes.max)}`)
  console.log(`endpoints  heap   min/p50/p95/max:  ${r.heapDeltaMB.min.toFixed(2)} / ${r.heapDeltaMB.p50.toFixed(2)} / ${r.heapDeltaMB.p95.toFixed(2)} / ${r.heapDeltaMB.max.toFixed(2)} MB`)
  if (r.schemaBundleBytes !== null || r.schemaHeapDeltaMB !== null) {
    console.log(
      `schema     bundle ${r.schemaBundleBytes === null ? 'n/a' : fmtBytes(r.schemaBundleBytes)}   heap ${
        r.schemaHeapDeltaMB === null ? 'n/a' : `${r.schemaHeapDeltaMB.toFixed(2)} MB`
      }`,
    )
  }
  console.log(`bundle wall    ${(r.bundleTimeMs / 1000).toFixed(2)}s   total wall ${(r.totalTimeMs / 1000).toFixed(2)}s`)
}

// CLI: bun run bench.ts --flavor=zodvex --count=50 [--fanin=N] [--registry]
//                       [--sample=10] [--cap=64] [--keep] [--out=path] [--all]
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const get = (k: string) => args.find(a => a.startsWith(`--${k}=`))?.split('=')[1]
  const has = (k: string) => args.includes(`--${k}`)
  const all = has('all')
  const flavors: Flavor[] = all
    ? ['zodvex', 'zodvex-mini', 'convex', 'convex-helpers', 'convex-helpers-zod3']
    : [((get('flavor') ?? 'zodvex') as Flavor)]
  const count = parseInt(get('count') ?? '50')
  const fanIn = parseInt(get('fanin') ?? '0')
  const registry = has('registry') || get('registry') !== undefined
  const regArg = get('registry')
  const registryMode: 'static' | 'lazy' | 'invisible' =
    (regArg === 'lazy' || has('lazy-registry')) ? 'lazy'
    : (regArg === 'invisible' || has('invisible-registry')) ? 'invisible'
    : 'static'
  const lazyTables = has('lazy-tables')
  const shape = (get('shape') ?? 'harness') as 'harness' | 'explicit' | 'consolidated'
  const models = get('models') ? parseInt(get('models')!, 10) : undefined
  const sample = get('sample') ? parseInt(get('sample')!) : undefined
  const cap = get('cap') ? parseInt(get('cap')!) : undefined
  const concurrency = get('concurrency') ? parseInt(get('concurrency')!) : 4
  const keep = has('keep')
  const out = get('out')

  const results: BenchResult[] = []
  for (const flavor of flavors) {
    const r = await bench({ flavor, count, models, fanIn, registry, registryMode, lazyTables, shape, sample, capMB: cap, concurrency, keep })
    printSummary(r)
    results.push(r)
  }

  if (out) {
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, JSON.stringify(results.length === 1 ? results[0] : results, null, 2))
    console.log(`\nWrote ${out}`)
  }
}
