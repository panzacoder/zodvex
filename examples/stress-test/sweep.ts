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
import { type Flavor } from './composeFlavor.js'
import { deploy, resetDeployment } from './realDeploy.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

interface CellResult {
  flavor: Flavor
  n: number
  outcome: string // 'ok' | 'oom' | 'function-limit' | 'bundle-limit' | 'schema-error' | 'timeout' | 'too-many-reads' | 'other'
  durationMs: number
  endpointHeapMaxMB: number
  schemaHeapMB: number | null
  errorTail: string | null
}

interface SweepConfig {
  flavors?: Flavor[]
  ns?: number[]
  /** Skip flavor at higher N once it's already failed at a lower N for the same flavor. Default true. */
  skipAfterFailure?: boolean
  outFile?: string
  /** Push an empty schema between each test. Default true. */
  reset?: boolean
}

/** Friendly outcome label that disambiguates the various 'other' Convex errors. */
function classifyOutcome(outcome: { kind: string; stderrSnippet?: string }): string {
  if (outcome.kind !== 'other') return outcome.kind
  const snippet = outcome.stderrSnippet ?? ''
  if (/TooManyReads/i.test(snippet)) return 'too-many-reads'
  if (/Too many function files/i.test(snippet)) return 'function-limit'
  if (/Total bundle/i.test(snippet) || /bundle.*too large/i.test(snippet)) return 'bundle-limit'
  return 'other'
}

export async function sweep(config: SweepConfig = {}): Promise<CellResult[]> {
  const flavors = config.flavors ?? [
    'convex',
    'convex-helpers-zod3',
    'convex-helpers',
    'zodvex',
    'zodvex-mini',
  ]
  const ns = config.ns ?? [200, 500, 800, 1000, 1500, 2000]
  const skipAfterFailure = config.skipAfterFailure ?? true
  const doReset = config.reset ?? true

  const results: CellResult[] = []

  for (const flavor of flavors) {
    const failed = new Set<string>()
    for (const n of ns) {
      if (skipAfterFailure && failed.has(flavor)) {
        results.push({
          flavor,
          n,
          outcome: 'skipped',
          durationMs: 0,
          endpointHeapMaxMB: 0,
          schemaHeapMB: null,
          errorTail: 'skipped after earlier failure for this flavor',
        })
        console.error(`[${flavor} N=${n}] skipped (earlier flavor failure)`)
        continue
      }

      if (doReset) {
        console.error(`[${flavor} N=${n}] reset…`)
        const reset = await resetDeployment({ verbose: false })
        if (reset.kind !== 'ok') {
          console.error(`[${flavor} N=${n}] reset failed (${reset.kind}); proceeding anyway`)
        }
      }

      console.error(`[${flavor} N=${n}] composing…`)
      const lazyTables = flavor === 'zodvex' || flavor === 'zodvex-mini'
      let measured
      try {
        measured = await bench({
          flavor,
          count: n,
          sample: 1,
          lazyTables,
          keep: true,
          verbose: false,
        })
      } catch (err) {
        console.error(`[${flavor} N=${n}] compose/bench failed: ${(err as Error).message}`)
        results.push({
          flavor,
          n,
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
      // Smoke-check the codec-wrapped db path on the first (smallest) N
      // per flavor — that's enough to catch runtime regressions like the
      // dynamic-import-unsupported bug. Higher Ns share the same codepath
      // so a single runtime verification per flavor covers them all.
      const isFirstN = n === ns[0]
      const outcome = await deploy({
        source: join(__dirname, 'tmp', flavor, 'composed'),
        timeoutMs: 5 * 60 * 1000,
        verbose: false,
        smokeFunction: isFirstN
          ? 'endpoints/activity_0000:listActivities'
          : undefined,
      })
      const kind = classifyOutcome(outcome)
      results.push({
        flavor,
        n,
        outcome: kind,
        durationMs: outcome.durationMs,
        endpointHeapMaxMB: measured.heapDeltaMB.max,
        schemaHeapMB: measured.schemaHeapDeltaMB,
        errorTail: 'stderrSnippet' in outcome ? (outcome.stderrSnippet ?? '').slice(-300) : null,
      })
      const icon = kind === 'ok' ? '✓' : '✗'
      console.error(`[${flavor} N=${n}] ${icon} ${kind} (${(outcome.durationMs / 1000).toFixed(1)}s)`)
      if (kind !== 'ok') failed.add(flavor)
    }
  }

  if (config.outFile) {
    const out = { timestamp: new Date().toISOString(), config: { flavors, ns, skipAfterFailure, doReset }, results }
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
        if (r.outcome === 'ok') return `✓ ${(r.durationMs / 1000).toFixed(0)}s`
        return `✗ ${r.outcome}`
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
  const outFile = get('out') ?? join(__dirname, 'results', `sweep-${new Date().toISOString().slice(0, 10)}.json`)

  console.error('zodvex ceiling sweep (resets deployment between tests)')
  const results = await sweep({
    flavors,
    ns,
    outFile,
    skipAfterFailure: !has('continue'),
  })

  console.log()
  console.log(formatTable(results))
  console.log()
  console.log(`Results written to ${outFile}`)
}
