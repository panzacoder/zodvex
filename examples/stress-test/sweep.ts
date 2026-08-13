// Authoritative ceiling sweep. Run rarely (after major library, codegen,
// or Convex-backend changes). Captures a single dated snapshot showing
// where each flavor breaks across a range of N values.
//
// Critical methodological note: each test resets the deployment to a
// near-empty state before composing + pushing the target. Without that,
// residual state from prior tests pollutes the finish_push diff and the
// TooManyReads wall fires at a lower N than the target alone would
// trigger. Don't skip the reset.
//
// Output: a single results/sweep-<date>.{md,json} pair.

import { writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { bench } from './bench.js'
import { type Flavor } from './compose.js'
import {
  collectMeta,
  fingerprintCell,
  isCacheableOutcome,
  loadCellCache,
  saveCellCache,
  type CachedCell,
} from './harnessMeta.js'
import { deploy, resetDeployment } from './realDeploy.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

interface CellResult {
  flavor: Flavor
  n: number
  /** zodvex consumer shape composed for this cell ('n/a' for parity flavors). */
  shape: string
  outcome: string // 'ok' | 'oom' | 'function-limit' | 'bundle-limit' | 'schema-error' | 'timeout' | 'too-many-reads' | 'other'
  durationMs: number
  endpointHeapMaxMB: number
  schemaHeapMB: number | null
  errorTail: string | null
  /** True when reused from the fingerprint cache instead of re-running. */
  cached?: boolean
}

interface SweepConfig {
  flavors?: Flavor[]
  ns?: number[]
  /** zodvex consumer shape to compose (parity flavors unaffected). Default 'explicit'. */
  shape?: 'harness' | 'explicit' | 'consolidated'
  /** Skip flavor at higher N once it's already failed at a lower N for the same flavor. Default true. */
  skipAfterFailure?: boolean
  outFile?: string
  /** Push an empty schema between each test. Default true. */
  reset?: boolean
  /** Re-run cells even when their fingerprint matches the cache. Default false. */
  force?: boolean
  /**
   * Axis control (mutually exclusive; default neither = legacy 1:1):
   *  - `models`: fix the model count; `ns` sweeps the ENDPOINT axis.
   *  - `endpoints`: fix the endpoint count; `ns` sweeps the MODEL axis.
   */
  models?: number
  endpoints?: number
}

/** Default zodvex consumer shape: 'explicit' is the documented shape MAIN
 *  supports (no codegen tables.ts), so a plain `bun run sweep` works
 *  against main. */
export const DEFAULT_SHAPE: 'harness' | 'explicit' | 'consolidated' = 'explicit'

export async function sweep(config: SweepConfig = {}): Promise<CellResult[]> {
  const flavors = config.flavors ?? [
    'convex',
    'convex-helpers-zod3',
    'convex-helpers',
    'zodvex',
    'zodvex-mini',
  ]
  const ns = config.ns ?? [200, 500, 800, 1000, 1500, 2000]
  const shape = config.shape ?? DEFAULT_SHAPE
  const skipAfterFailure = config.skipAfterFailure ?? true
  const doReset = config.reset ?? true
  const force = config.force ?? false

  if (config.models !== undefined && config.endpoints !== undefined) {
    throw new Error('--models and --endpoints are mutually exclusive')
  }
  const meta = collectMeta()
  const cache = loadCellCache()
  const results: CellResult[] = []

  for (const flavor of flavors) {
    const failed = new Set<string>()
    for (const n of ns) {
      if (skipAfterFailure && failed.has(flavor)) {
        results.push({
          flavor,
          n,
          shape: flavor === 'zodvex' || flavor === 'zodvex-mini' ? shape : 'n/a',
          outcome: 'skipped',
          durationMs: 0,
          endpointHeapMaxMB: 0,
          schemaHeapMB: null,
          errorTail: 'skipped after earlier failure for this flavor',
        })
        console.error(`[${flavor} N=${n}] skipped (earlier flavor failure)`)
        continue
      }

      const isZodvex = flavor === 'zodvex' || flavor === 'zodvex-mini'
      const cellShape = isZodvex ? shape : 'n/a'
      // Resolve the two axes for this cell.
      const cellEndpoints = config.endpoints ?? n
      const cellModels = config.models ?? (config.endpoints !== undefined ? n : n)

      // Fingerprint cache: a cell whose inputs (seeds, harness logic,
      // package versions, relevant dists, deployment) are unchanged reuses
      // its prior outcome. Parity flavors' fingerprints exclude the zodvex
      // dist, so zodvex development never invalidates their baselines.
      const fp = fingerprintCell({ flavor, shape: cellShape, n: cellEndpoints, models: cellModels }, meta)
      const hit = cache[fp]
      if (hit && !force) {
        console.error(`[${flavor} N=${n}] ↩ cached ${hit.outcome} (from ${hit.cachedAt.slice(0, 10)})`)
        results.push({
          flavor,
          n,
          shape: cellShape,
          outcome: hit.outcome,
          durationMs: hit.durationMs,
          endpointHeapMaxMB: hit.endpointHeapMaxMB,
          schemaHeapMB: hit.schemaHeapMB,
          errorTail: hit.errorTail,
          cached: true,
        })
        if (hit.outcome !== 'ok') failed.add(flavor)
        continue
      }

      // Whether the cell ran against a clean deployment — diff-dependent
      // outcomes (ok, too-many-reads) are only cacheable when it did.
      let resetOk = false
      if (doReset) {
        console.error(`[${flavor} N=${n}] reset…`)
        const reset = await resetDeployment({ verbose: false })
        resetOk = reset.kind === 'ok'
        if (!resetOk) {
          console.error(`[${flavor} N=${n}] reset failed (${reset.kind}); proceeding anyway`)
        }
      }

      console.error(`[${flavor} N=${n}] composing…`)
      // Thin schema (codegen tables.ts) exists only for the consolidated
      // shape; explicit and harness compose without codegen output.
      const lazyTables = isZodvex && shape === 'consolidated'
      let measured
      try {
        measured = await bench({
          flavor,
          count: cellEndpoints,
          models: cellModels,
          sample: 1,
          lazyTables,
          shape: isZodvex ? shape : 'harness',
          keep: true,
          verbose: false,
        })
      } catch (err) {
        console.error(`[${flavor} N=${n}] compose/bench failed: ${(err as Error).message}`)
        results.push({
          flavor,
          n,
          shape: cellShape,
          outcome: 'compose-failed',
          durationMs: 0,
          endpointHeapMaxMB: 0,
          schemaHeapMB: null,
          errorTail: (err as Error).message.slice(0, 400),
        })
        failed.add(flavor)
        continue
      }

      console.error(`[${flavor} N=${n}] deploying…`)
      // Smoke EVERY passing cell, not just the first N: the runtime Q/M
      // isolate has the same 64 MB cap as analysis, so runtime failures
      // are N-dependent — "same codepath" does not mean "same memory".
      // The healthcheck endpoint asserts the semantics the composed shape
      // promises (codec decode for consolidated zodvex, raw round-trip
      // otherwise); the consolidated shape additionally exercises
      // scheduler codec-arg encoding via the args-only registry.
      const smokeFns = ['endpoints/healthcheck:healthcheck']
      if (isZodvex && shape !== 'harness') {
        // Registry-wired shapes (explicit since 0.7.5, consolidated) also
        // encode scheduler codec args — exercise that path too.
        smokeFns.push('endpoints/healthcheck:healthcheckScheduler')
      }
      const outcome = await deploy({
        source: join(__dirname, 'tmp', flavor, 'composed'),
        timeoutMs: 5 * 60 * 1000,
        verbose: false,
        smokeFunction: smokeFns,
      })
      const kind = outcome.kind
      const cell: CellResult = {
        flavor,
        n,
        shape: cellShape,
        outcome: kind,
        durationMs: outcome.durationMs,
        endpointHeapMaxMB: measured.heapDeltaMB.max,
        schemaHeapMB: measured.schemaHeapDeltaMB,
        errorTail: 'stderrSnippet' in outcome ? (outcome.stderrSnippet ?? '').slice(-300) : null,
      }
      results.push(cell)
      if (isCacheableOutcome(outcome, resetOk)) {
        cache[fp] = {
          outcome: cell.outcome,
          durationMs: cell.durationMs,
          endpointHeapMaxMB: cell.endpointHeapMaxMB,
          schemaHeapMB: cell.schemaHeapMB,
          errorTail: cell.errorTail,
          cachedAt: new Date().toISOString(),
          key: { flavor, shape: cellShape, n: cellEndpoints, models: cellModels },
        } satisfies CachedCell
        saveCellCache(cache)
      } else {
        console.error(`[${flavor} N=${n}] not caching ${kind} (transient or contaminated by failed reset)`)
      }
      const icon = kind === 'ok' ? '✓' : '✗'
      console.error(`[${flavor} N=${n}] ${icon} ${kind} (${(outcome.durationMs / 1000).toFixed(1)}s)`)
      if (kind !== 'ok') failed.add(flavor)
    }
  }

  if (config.outFile) {
    const out = { meta, config: { flavors, ns, shape, models: config.models ?? null, endpoints: config.endpoints ?? null, skipAfterFailure, doReset, force }, results }
    mkdirSync(dirname(config.outFile), { recursive: true })
    writeFileSync(config.outFile, JSON.stringify(out, null, 2))
  }

  return results
}

function formatTable(results: CellResult[]): string {
  // Pivot: row per flavor, column per N
  const flavors = Array.from(new Set(results.map(r => r.flavor)))
  const ns = Array.from(new Set(results.map(r => r.n))).sort((a, b) => a - b)
  const rows = [
    ['flavor', ...ns.map(n => `N=${n}`)],
    ['---', ...ns.map(() => '---')],
    ...flavors.map(f => [
      f,
      ...ns.map(n => {
        const r = results.find(x => x.flavor === f && x.n === n)
        if (!r) return '—'
        const c = r.cached ? ' (c)' : ''
        if (r.outcome === 'ok') return `✓ ${(r.durationMs / 1000).toFixed(0)}s${c}`
        return `✗ ${r.outcome}${c}`
      }),
    ]),
  ]
  const widths = rows[0].map((_, i) => Math.max(...rows.map(r => r[i].length)))
  return rows.map(r => r.map((c, i) => c.padEnd(widths[i])).join('  ')).join('\n')
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const get = (k: string) => args.find(a => a.startsWith(`--${k}=`))?.split('=')[1]
  const has = (k: string) => args.includes(`--${k}`)
  const flavors = get('flavors')?.split(',') as Flavor[] | undefined
  const ns = get('ns')?.split(',').map(s => parseInt(s, 10))
  // Default under results/local/ (gitignored): results/ proper is the
  // curated, hand-promoted snapshot set.
  const outFile = get('out') ?? join(__dirname, 'results', 'local', `sweep-${new Date().toISOString().slice(0, 10)}.json`)

  console.error('zodvex ceiling sweep (resets deployment between tests)')
  const results = await sweep({
    flavors,
    ns,
    shape: get('shape') as 'harness' | 'explicit' | 'consolidated' | undefined,
    models: get('models') ? parseInt(get('models')!, 10) : undefined,
    endpoints: get('endpoints') ? parseInt(get('endpoints')!, 10) : undefined,
    outFile,
    skipAfterFailure: !has('continue'),
    force: has('force'),
  })

  console.log()
  console.log(formatTable(results))
  console.log()
  console.log(`Results written to ${outFile}`)
}
