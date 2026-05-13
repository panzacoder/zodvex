// Pass/fail regression harness at a fixed target N across all flavors.
//
// Sweep mode (bench.ts) is preserved for exploratory work — that's how we
// find ceilings. This script is for CI/release verification: a single
// known-good target proves zodvex stays competitive with pure-convex and
// continues to beat plain convex-helpers/zod4.
//
// Default target: N=800 endpoints (~4,000 functions). Sits well below
// Convex's documented limits (8,192 functions, 4,096 read intervals per
// transaction) and below the empirical TooManyReads wall (~N=2000). Gives
// room for back-to-back runs against the same deployment without diff-
// stacking failures.
//
// Per flavor: compose → bundle → measure schema + endpoint heap → real
// deploy. Output is a comparison table; exit 0 iff all flavors expected
// to pass actually did.

import { writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { bench } from './bench.js'
import { type Flavor } from './composeFlavor.js'
import { deploy, type DeployOutcome } from './realDeploy.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

interface FlavorOutcome {
  flavor: Flavor
  deploy: DeployOutcome['kind']
  durationMs: number
  endpointHeapMaxMB: number
  schemaHeapMB: number | null
  /** Pass/fail per the flavor's expected outcome at this target. */
  ok: boolean
  /** Notes describing why the result is interesting (e.g. "matches pure-convex"). */
  note: string
}

interface FlavorPlan {
  flavor: Flavor
  /** Use lazy-tables shape (zodvex flavors only). */
  lazyTables: boolean
  /** What we expect at the target — used to decide pass/fail. */
  expectedDeploy: 'ok' | 'oom'
  note: string
}

/**
 * Expected outcomes at N=800. Updates here are signals that the underlying
 * library or Convex backend behavior changed. Update intentionally.
 */
const DEFAULT_PLAN: FlavorPlan[] = [
  { flavor: 'convex', lazyTables: false, expectedDeploy: 'ok',
    note: 'baseline: plain Convex validators, no zod' },
  { flavor: 'convex-helpers-zod3', lazyTables: false, expectedDeploy: 'ok',
    note: 'zod3 + convex-helpers adapter; ~6× lighter per object than zod4' },
  { flavor: 'zodvex', lazyTables: true, expectedDeploy: 'ok',
    note: 'zodvex (full zod) with the new lazy-tables + marker + consolidated server.ts' },
  { flavor: 'zodvex-mini', lazyTables: true, expectedDeploy: 'ok',
    note: 'zodvex/mini (zod-mini); should match zodvex performance + slightly lighter' },
  { flavor: 'convex-helpers', lazyTables: false, expectedDeploy: 'oom',
    note: 'reference point: plain convex-helpers/zod4 still OOMs at this N (no lazy schema)' },
]

export interface RegressionOptions {
  target?: number
  outFile?: string
  /** Override the default plan (mainly for testing). */
  plan?: FlavorPlan[]
}

export async function regression(opts: RegressionOptions = {}): Promise<{
  ok: boolean
  outcomes: FlavorOutcome[]
}> {
  const target = opts.target ?? 800
  const plan = opts.plan ?? DEFAULT_PLAN
  const outcomes: FlavorOutcome[] = []

  for (const entry of plan) {
    console.error(`\n[${entry.flavor}] composing N=${target}${entry.lazyTables ? ' lazy-tables' : ''}…`)
    const measured = await bench({
      flavor: entry.flavor,
      count: target,
      sample: 1,
      lazyTables: entry.lazyTables,
      keep: true,
      verbose: false,
    })

    console.error(`[${entry.flavor}] deploying…`)
    const outcome = await deploy({
      source: measured.perEndpoint.length > 0
        ? join(__dirname, 'tmp', entry.flavor, 'composed')
        : join(__dirname, 'tmp', entry.flavor, 'composed'),
      timeoutMs: 5 * 60 * 1000,
      verbose: false,
    })

    const ok = outcome.kind === entry.expectedDeploy
    outcomes.push({
      flavor: entry.flavor,
      deploy: outcome.kind,
      durationMs: outcome.durationMs,
      endpointHeapMaxMB: measured.heapDeltaMB.max,
      schemaHeapMB: measured.schemaHeapDeltaMB,
      ok,
      note: entry.note,
    })

    const icon = ok ? '✓' : '✗'
    console.error(`[${entry.flavor}] ${icon} ${outcome.kind} (${(outcome.durationMs / 1000).toFixed(1)}s)`)
  }

  const allOk = outcomes.every(o => o.ok)
  if (opts.outFile) {
    const out = {
      target,
      timestamp: new Date().toISOString(),
      allOk,
      outcomes,
    }
    mkdirSync(dirname(opts.outFile), { recursive: true })
    writeFileSync(opts.outFile, JSON.stringify(out, null, 2))
  }
  return { ok: allOk, outcomes }
}

function fmtTable(target: number, outcomes: FlavorOutcome[]): string {
  const rows = [
    ['flavor', 'deploy', 'endpoint heap', 'schema heap', 'time', 'ok'],
    ['---', '---', '---', '---', '---', '---'],
    ...outcomes.map(o => [
      o.flavor,
      o.deploy,
      `${o.endpointHeapMaxMB.toFixed(2)} MB`,
      o.schemaHeapMB === null ? 'n/a' : `${o.schemaHeapMB.toFixed(2)} MB`,
      `${(o.durationMs / 1000).toFixed(1)}s`,
      o.ok ? '✓' : '✗',
    ]),
  ]
  const widths = rows[0].map((_, i) => Math.max(...rows.map(r => r[i].length)))
  return rows.map(r => r.map((c, i) => c.padEnd(widths[i])).join('  ')).join('\n')
    + `\n\nTarget: N=${target} endpoints (~${target * 5} functions)`
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const get = (k: string) => args.find(a => a.startsWith(`--${k}=`))?.split('=')[1]
  const target = get('target') ? parseInt(get('target')!) : 800
  const outFile = get('out') ?? join(__dirname, 'results', `regression-${new Date().toISOString().slice(0, 10)}.json`)

  console.error(`zodvex regression suite — target N=${target}`)
  const { ok, outcomes } = await regression({ target, outFile })

  console.log()
  console.log(fmtTable(target, outcomes))
  console.log()
  console.log(ok ? '✓ all flavors matched expected outcomes' : '✗ unexpected outcomes — review above')
  process.exit(ok ? 0 : 1)
}
