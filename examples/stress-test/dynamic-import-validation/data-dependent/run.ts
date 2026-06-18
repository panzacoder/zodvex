// Driver for the data-dependent dynamic-import variant.
//
// Deploys N table modules (stamped from the task-manager archetypes) + the
// decodeTouched action once, then runs two passes:
//
//   1. CORRECTNESS — invoke decodeTouched with one table per archetype, chosen
//      at runtime. Confirms a dynamically-imported, runtime-selected model
//      decodes its varied codecs correctly (dates, ids, zDuration, tagged,
//      nested-union, top-level-union, slim). This is the new axis.
//
//   2. MEMORY — invoke decodeTouched with count=K across a ladder. Reconfirms
//      that evaluation (and the OOM threshold) tracks touched-K, not deployed-N,
//      now with a real decode workload.
//
// Requires CONVEX_DEPLOYMENT (env or examples/stress-test/_deploy/.env.local).

import { spawn, execSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { generate } from './generate.js'
import { deploy, resetDeployment } from '../../realDeploy.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DEPLOY_DIR = join(__dirname, '..', '..', '_deploy')
const RESULTS_DIR = join(__dirname, '..', 'results')

const OOM_PATTERNS = [/maximum memory usage:\s*64\s*MB/i, /ran out of memory/i, /Heap usage too high/i]
const DEFAULT_LADDER = [1, 5, 10, 25, 50, 100, 150, 200, 300, 500, 750]

const tail = (s: string, n = 10) => s.trim().split('\n').slice(-n).join('\n')

function resolveSlug(): string | undefined {
  if (process.env.CONVEX_DEPLOYMENT) return process.env.CONVEX_DEPLOYMENT
  const env = join(DEPLOY_DIR, '.env.local')
  if (existsSync(env)) return readFileSync(env, 'utf-8').match(/CONVEX_DEPLOYMENT=(\S+)/)?.[1]
  return undefined
}

function gitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'unknown'
  }
}

/** Parse the function return value out of `convex run` stdout (last JSON block). */
function parseReturn(stdout: string): unknown {
  const trimmed = stdout.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    // Scan from the end for a parseable JSON object/array.
    const lines = trimmed.split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      const s = lines.slice(i).join('\n').trim()
      try {
        return JSON.parse(s)
      } catch {
        /* keep scanning */
      }
    }
    return undefined
  }
}

type RunResult = { kind: 'ok' | 'oom' | 'error' | 'timeout'; ms: number; output?: unknown; snippet?: string }

function runAction(
  fn: string,
  args: Record<string, unknown>,
  slug: string,
  timeoutMs = 120_000,
): Promise<RunResult> {
  return new Promise((resolve) => {
    let out = ''
    let err = ''
    let killed = false
    const started = Date.now()
    const child = spawn('bunx', ['convex', 'run', fn, JSON.stringify(args)], {
      cwd: DEPLOY_DIR,
      env: { ...process.env, CONVEX_DEPLOYMENT: slug },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const t = setTimeout(() => {
      killed = true
      child.kill('SIGKILL')
    }, timeoutMs)
    child.stdout.on('data', (b) => {
      out += b.toString()
    })
    child.stderr.on('data', (b) => {
      err += b.toString()
    })
    child.on('close', (code) => {
      clearTimeout(t)
      const ms = Date.now() - started
      if (killed) return resolve({ kind: 'timeout', ms })
      const combined = `${err}\n${out}`
      if (OOM_PATTERNS.some((re) => re.test(combined)))
        return resolve({ kind: 'oom', ms, snippet: tail(combined) })
      if (code !== 0) return resolve({ kind: 'error', ms, snippet: tail(combined) })
      resolve({ kind: 'ok', ms, output: parseReturn(out) })
    })
  })
}

function writeResults(name: string, data: Record<string, unknown>): void {
  mkdirSync(RESULTS_DIR, { recursive: true })
  const p = join(RESULTS_DIR, `${name}-${Date.now()}.json`)
  writeFileSync(p, JSON.stringify({ ...data, git: gitSha(), ts: new Date().toISOString() }, null, 2))
  console.error(`[results] ${p}`)
}

async function main(models: number, ladder: number[]): Promise<void> {
  const slug = resolveSlug()
  if (!slug) throw new Error('CONVEX_DEPLOYMENT not set (env or _deploy/.env.local)')

  const out = join(__dirname, '.out')
  console.error(`[gen] ${models} models (task-manager archetypes) + decodeTouched action`)
  const { tables } = generate({ models, outDir: out })

  console.error('[reset] clearing deployment state')
  await resetDeployment({ verbose: false })
  console.error('[deploy] pushing models + action')
  const dep = await deploy({ source: out, verbose: true })

  const results: Record<string, unknown> = { models, deploy: dep.kind }
  if (dep.kind !== 'ok') {
    results.deployDetail = dep
    console.error(`[deploy] FAILED: ${dep.kind}`)
    writeResults(`div-datadep-${models}`, results)
    return
  }

  // Pass 1 — CORRECTNESS: one runtime-selected table per archetype.
  const perArch: Record<string, string> = {}
  for (const t of tables) if (!perArch[t.archetype]) perArch[t.archetype] = t.name
  const correctnessTables = Object.values(perArch)
  console.error(`[correctness] decoding one of each archetype via lazy import: ${correctnessTables.join(', ')}`)
  const corr = await runAction('dataDependent:decodeTouched', { tables: correctnessTables }, slug)
  results.correctness = corr.output ?? { kind: corr.kind, snippet: corr.snippet }
  const co = corr.output as { passed?: number; failed?: number; results?: unknown[] } | undefined
  if (corr.kind === 'ok' && co) {
    console.error(`[correctness] passed=${co.passed} failed=${co.failed}`)
    for (const r of co.results ?? []) console.error(`    ${JSON.stringify(r)}`)
  } else {
    console.error(`[correctness] run did not return cleanly: ${corr.kind} ${corr.snippet ?? ''}`)
  }

  // Pass 2 — MEMORY: evaluation tracks touched-K with a real decode workload.
  console.error(`[memory] sweeping decodeTouched count=K (deployed=${models})`)
  const cells: Array<Record<string, unknown>> = []
  for (const k of ladder.filter((k) => k <= models)) {
    const r = await runAction('dataDependent:decodeTouched', { count: k }, slug)
    const ev = (r.output as { evaluated?: number; passed?: number; failed?: number } | undefined)
    console.error(`  K=${k}: ${r.kind} (${r.ms}ms)${ev ? ` evaluated=${ev.evaluated} passed=${ev.passed} failed=${ev.failed}` : ''}`)
    cells.push({ k, kind: r.kind, ms: r.ms, evaluated: ev?.evaluated, passed: ev?.passed, failed: ev?.failed, snippet: r.snippet })
  }
  results.memory = cells
  const firstOom = cells.find((c) => c.kind === 'oom')
  results.oomThreshold = firstOom ? firstOom.k : null

  writeResults(`div-datadep-${models}`, results)
}

// CLI: bun run run.ts --models=750 [--ladder=1,10,50,...]
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const get = (k: string, d?: string) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d
  const models = parseInt(get('models', '750')!)
  const ladder = get('ladder') ? get('ladder')!.split(',').map(Number) : DEFAULT_LADDER
  await main(models, ladder)
}
