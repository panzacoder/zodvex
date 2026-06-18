// Driver for the dynamic-import memory-validation experiment.
//
// Reuses the harness's realDeploy.ts (deploy / resetDeployment) so this runs
// against the same configured Convex dev deployment as the main sweeps.
//
// Two modes:
//
//   --mode=dynamic --models=750   (the experiment Ian asked for)
//     Generate ONE deployment with N models + the loadSubset action, push it
//     once, then invoke loadSubset({count: K}) across a K-ladder. The deploy
//     should succeed (the analyzer skips dynamic imports), and the headline
//     result is that with N models DEPLOYED, small-K invocations stay well
//     under budget — the unimported models cost nothing — while memory (and
//     the OOM threshold) scale with K, not N.
//
//   --mode=static                 (the eager baseline / control)
//     For each K in the ladder, generate an action that STATICALLY imports K
//     models, push it, and record the outcome. Expected: OOM at the same low
//     K the q/m static graph hits today. Establishes the contrast.
//
// Requires CONVEX_DEPLOYMENT (env or examples/stress-test/_deploy/.env.local).

import { spawn, execSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { generate } from './generate.js'
import { deploy, resetDeployment } from '../realDeploy.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DEPLOY_DIR = join(__dirname, '..', '_deploy')
const RESULTS_DIR = join(__dirname, 'results')

const OOM_PATTERNS = [
  /maximum memory usage:\s*64\s*MB/i,
  /ran out of memory/i,
  /Heap usage too high/i,
]

const DEFAULT_LADDER = [1, 5, 10, 25, 50, 100, 150, 200, 250, 300, 350, 400, 500, 600, 750]

function resolveSlug(): string | undefined {
  if (process.env.CONVEX_DEPLOYMENT) return process.env.CONVEX_DEPLOYMENT
  const env = join(DEPLOY_DIR, '.env.local')
  if (existsSync(env)) return readFileSync(env, 'utf-8').match(/CONVEX_DEPLOYMENT=(\S+)/)?.[1]
  return undefined
}

const tail = (s: string, n = 8) => s.trim().split('\n').slice(-n).join('\n')

type RunResult = { kind: 'ok' | 'oom' | 'error' | 'timeout'; ms: number; output?: string; snippet?: string }

/** `convex run <fn> <jsonArgs>` against the staged deployment, classified. */
function runAction(
  fn: string,
  args: Record<string, unknown>,
  slug: string,
  timeoutMs = 90_000,
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
      resolve({ kind: 'ok', ms, output: out.trim() })
    })
  })
}

function gitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'unknown'
  }
}

function writeResults(name: string, data: Record<string, unknown>): void {
  mkdirSync(RESULTS_DIR, { recursive: true })
  const p = join(RESULTS_DIR, `${name}-${Date.now()}.json`)
  writeFileSync(p, JSON.stringify({ ...data, git: gitSha(), ts: new Date().toISOString() }, null, 2))
  console.error(`[results] ${p}`)
}

async function dynamicMode(models: number, ladder: number[]): Promise<void> {
  const slug = resolveSlug()
  if (!slug) throw new Error('CONVEX_DEPLOYMENT not set (env or _deploy/.env.local)')

  const out = join(__dirname, '.out', 'dynamic')
  console.error(`[gen] ${models} models + dynamic loadSubset action`)
  generate({ models, mode: 'dynamic', outDir: out })

  console.error('[reset] clearing deployment state')
  await resetDeployment({ verbose: false })

  console.error('[deploy] pushing models + action (expected ok: analyzer skips dynamic imports)')
  const dep = await deploy({ source: out, verbose: true })
  const results: Record<string, unknown> = { mode: 'dynamic', models, deploy: dep.kind, cells: [] }
  const cells = results.cells as Array<Record<string, unknown>>

  if (dep.kind !== 'ok') {
    console.error(`[deploy] FAILED: ${dep.kind} — see detail`)
    results.deployDetail = dep
    writeResults(`div-dynamic-${models}`, results)
    return
  }

  console.error(`[invoke] sweeping loadSubset over K (models deployed = ${models})`)
  for (const k of ladder.filter((k) => k <= models)) {
    const r = await runAction('dynImport:loadSubset', { count: k }, slug)
    const note = r.kind === 'ok' ? r.output : (r.snippet?.split('\n').pop() ?? '')
    console.error(`  K=${k}: ${r.kind} (${r.ms}ms) ${note ?? ''}`)
    cells.push({ k, kind: r.kind, ms: r.ms, output: r.output, snippet: r.snippet })
  }

  const firstOom = cells.find((c) => c.kind === 'oom')
  results.oomThreshold = firstOom ? firstOom.k : null
  results.maxOk = cells.filter((c) => c.kind === 'ok').reduce((m, c) => Math.max(m, c.k as number), 0)
  console.error(
    `[summary] N=${models} deployed · max K ok = ${results.maxOk} · first OOM at K = ${results.oomThreshold ?? 'none in ladder'}`,
  )
  writeResults(`div-dynamic-${models}`, results)
}

async function staticMode(ladder: number[]): Promise<void> {
  const slug = resolveSlug()
  if (!slug) throw new Error('CONVEX_DEPLOYMENT not set (env or _deploy/.env.local)')

  const out = join(__dirname, '.out', 'static')
  const results: Record<string, unknown> = { mode: 'static', cells: [] }
  const cells = results.cells as Array<Record<string, unknown>>

  for (const k of ladder) {
    console.error(`[gen] static-eager action importing ${k} models`)
    generate({ models: k, mode: 'static', outDir: out })
    await resetDeployment({ verbose: false })
    const dep = await deploy({ source: out, verbose: true })
    console.error(`  N=${k}: ${dep.kind}`)
    cells.push({ k, deploy: dep.kind, durationMs: (dep as { durationMs?: number }).durationMs })
    if (dep.kind === 'oom') {
      console.error(`[summary] static-eager cliff at N=${k}`)
      results.cliff = k
      break
    }
  }
  writeResults('div-static', results)
}

// CLI: bun run sweep.ts --mode=dynamic --models=750 [--ladder=1,10,50,...]
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const get = (k: string, d?: string) =>
    args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d
  const mode = get('mode', 'dynamic')
  const models = parseInt(get('models', '750')!)
  const ladder = get('ladder') ? get('ladder')!.split(',').map(Number) : DEFAULT_LADDER

  if (mode === 'dynamic') await dynamicMode(models, ladder)
  else if (mode === 'static') await staticMode(ladder.filter((k) => k <= models))
  else throw new Error(`unknown --mode=${mode} (expected 'dynamic' or 'static')`)
}
