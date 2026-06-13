// Real-deploy probe against a configured Convex dev deployment.
//
// Designed fresh — does not lift code from any prior PR. The goal is a
// fast, single-shot push that returns a structured outcome (ok / oom /
// schema-error / other) so the bench harness can verify the per-bundle
// numbers correspond to real backend behavior.
//
// The scaffold at examples/stress-test/_deploy/ is a self-contained mini
// Convex app: package.json, convex.config.ts, .env.local symlink, and a
// node_modules symlink back to the stress-test's installed deps. A clean
// project marker means the convex CLI treats the dir as a normal project.
//
// One deploy currently takes ~2 s for an empty schema and ~5 s for 200
// endpoints. Far cheaper than the prior approach.

import { spawn } from 'child_process'
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { ComposeResult } from './compose.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DEPLOY_DIR = join(__dirname, '_deploy')
const DEPLOY_CONVEX = join(DEPLOY_DIR, 'convex')

const OOM_PATTERNS = [
  /maximum memory usage:\s*64\s*MB/i,
  /JavaScript execution ran out of memory/i,
  /Heap usage too high/i,
]

const FUNCTION_LIMIT_PATTERNS = [
  /too many functions/i,
  /function array/i,
]

const BUNDLE_LIMIT_PATTERNS = [
  /bundle.*too large/i,
  /total bundle size/i,
]

const TOO_MANY_READS_PATTERNS = [
  /TooManyReads/,
  /Too many reads/i,
]

export type DeployOutcome =
  | { kind: 'ok'; durationMs: number; stdoutTail: string; smokeOutputs?: Record<string, string> }
  | { kind: 'oom'; durationMs: number; stderrSnippet: string }
  | { kind: 'function-limit'; durationMs: number; stderrSnippet: string }
  | { kind: 'bundle-limit'; durationMs: number; stderrSnippet: string }
  | { kind: 'schema-error'; durationMs: number; stderrSnippet: string }
  | { kind: 'too-many-reads'; durationMs: number; stderrSnippet: string }
  | { kind: 'runtime-error'; durationMs: number; stderrSnippet: string }
  | { kind: 'timeout'; durationMs: number }
  | { kind: 'other'; exitCode: number; durationMs: number; stderrSnippet: string; stdoutTail: string }

export interface DeployOptions {
  /** Path to the composed convex/ directory to upload. */
  source: string
  /** CONVEX_DEPLOYMENT slug. Read from env if omitted. */
  deployment?: string
  /** Push timeout in ms. Default 5 minutes. */
  timeoutMs?: number
  /** Log progress to stderr. Default true. */
  verbose?: boolean
  /**
   * If set, after a successful deploy run `convex run <function>` and
   * downgrade to `runtime-error` on failure. The query/mutation called
   * exercises the codec-wrapped db path — used to detect cases where the
   * deploy passes analyzer checks but Q/M handlers crash at runtime
   * (e.g. the "dynamic module import unsupported" regression).
   */
  /** One or more no-arg function paths to `convex run` after a successful push. */
  smokeFunction?: string | string[]
}

function classify(stdout: string, stderr: string): DeployOutcome['kind'] {
  const combined = `${stderr}\n${stdout}`
  if (OOM_PATTERNS.some(re => re.test(combined))) return 'oom'
  if (FUNCTION_LIMIT_PATTERNS.some(re => re.test(combined))) return 'function-limit'
  if (BUNDLE_LIMIT_PATTERNS.some(re => re.test(combined))) return 'bundle-limit'
  if (TOO_MANY_READS_PATTERNS.some(re => re.test(combined))) return 'too-many-reads'
  if (/schema/i.test(stderr) && /error/i.test(stderr)) return 'schema-error'
  return 'other'
}

/**
 * Invokes `bunx convex run <function> '{}'` against the configured
 * deployment. Returns null on success, or a stderr snippet describing
 * the failure on error. Used as a post-deploy smoke check to verify
 * Q/M handlers actually run — deploy success alone misses regressions
 * like the dynamic-import-unsupported one.
 */
function smokeCall(
  fnPath: string,
  slug: string,
  timeoutMs: number,
): Promise<{ error: string | null; output: string }> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let killed = false

    const child = spawn(
      'bunx',
      ['convex', 'run', fnPath, '{}'],
      {
        cwd: DEPLOY_DIR,
        env: { ...process.env, CONVEX_DEPLOYMENT: slug },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )

    const timer = setTimeout(() => {
      killed = true
      child.kill('SIGKILL')
    }, timeoutMs)

    child.stdout.on('data', (b) => { stdout += b.toString() })
    child.stderr.on('data', (b) => { stderr += b.toString() })

    child.on('close', (code) => {
      clearTimeout(timer)
      if (killed) {
        resolve({ error: `smoke timeout after ${timeoutMs}ms`, output: '' })
        return
      }
      // Any non-zero exit or "dynamic module import" / "Server Error" in
      // either stream means the handler crashed at runtime.
      const combined = `${stderr}\n${stdout}`
      const failure =
        /dynamic module import/i.test(combined) ||
        /Server Error/i.test(combined) ||
        /Uncaught/.test(combined)
      if (code !== 0 || failure) {
        resolve({ error: lastLines(combined, 10), output: '' })
        return
      }
      resolve({ error: null, output: stdout.trim() })
    })
  })
}

function lastLines(s: string, n: number): string {
  return s.trim().split('\n').slice(-n).join('\n')
}

/**
 * Populate _deploy/convex/ with the composed source. Preserves
 * convex.config.ts and the convex/_zodvex/ stubs the consumer expects.
 */
function stageSource(source: string): void {
  if (!existsSync(source)) throw new Error(`source not found: ${source}`)

  // Wipe everything in _deploy/convex/ except convex.config.ts and _generated
  // (which Convex CLI manages).
  if (existsSync(DEPLOY_CONVEX)) {
    for (const entry of readdirSync(DEPLOY_CONVEX, { withFileTypes: true })) {
      if (entry.name === 'convex.config.ts' || entry.name === '_generated') continue
      const p = join(DEPLOY_CONVEX, entry.name)
      rmSync(p, { recursive: true, force: true })
    }
  } else {
    mkdirSync(DEPLOY_CONVEX, { recursive: true })
  }

  if (!existsSync(join(DEPLOY_CONVEX, 'convex.config.ts'))) {
    writeFileSync(
      join(DEPLOY_CONVEX, 'convex.config.ts'),
      "import { defineApp } from 'convex/server'\nconst app = defineApp()\nexport default app\n",
    )
  }

  cpSync(source, DEPLOY_CONVEX, { recursive: true })
}

export function deploy(opts: DeployOptions): Promise<DeployOutcome> {
  const { source, deployment, timeoutMs = 5 * 60 * 1000, verbose = true, smokeFunction } = opts

  // Resolve deployment slug.
  let slug = deployment ?? process.env.CONVEX_DEPLOYMENT
  if (!slug) {
    const envFile = join(DEPLOY_DIR, '.env.local')
    if (existsSync(envFile)) {
      const m = readFileSync(envFile, 'utf-8').match(/CONVEX_DEPLOYMENT=(\S+)/)
      if (m) slug = m[1]
    }
  }
  if (!slug) {
    return Promise.resolve({
      kind: 'other',
      exitCode: -1,
      durationMs: 0,
      stderrSnippet: 'CONVEX_DEPLOYMENT not set (env or _deploy/.env.local)',
      stdoutTail: '',
    })
  }

  stageSource(source)

  const startedAt = Date.now()
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let killed = false

    const child = spawn(
      'bunx',
      ['convex', 'dev', '--once', '--typecheck=disable'],
      {
        cwd: DEPLOY_DIR,
        env: { ...process.env, CONVEX_DEPLOYMENT: slug },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )

    const timer = setTimeout(() => {
      killed = true
      child.kill('SIGKILL')
    }, timeoutMs)

    child.stdout.on('data', (b) => {
      stdout += b.toString()
      if (verbose) process.stderr.write('.')
    })
    child.stderr.on('data', (b) => { stderr += b.toString() })

    child.on('close', (code) => {
      clearTimeout(timer)
      const durationMs = Date.now() - startedAt
      if (verbose) process.stderr.write('\n')

      if (killed) {
        resolve({ kind: 'timeout', durationMs })
        return
      }

      if (code === 0) {
        const smokeFns =
          smokeFunction === undefined
            ? []
            : Array.isArray(smokeFunction)
              ? smokeFunction
              : [smokeFunction]
        if (smokeFns.length > 0) {
          // Deploy succeeded — verify Q/M handlers actually run. Each smoke
          // function runs sequentially; the first failure wins. Successful
          // outputs are captured (the healthcheck returns runtime
          // transaction metrics for the results record).
          ;(async () => {
            const smokeOutputs: Record<string, string> = {}
            for (const fn of smokeFns) {
              const r = await smokeCall(fn, slug!, 30_000)
              if (r.error) {
                resolve({
                  kind: 'runtime-error',
                  durationMs: Date.now() - startedAt,
                  stderrSnippet: `[smoke ${fn}] ${r.error}`,
                })
                return
              }
              smokeOutputs[fn] = r.output
            }
            resolve({
              kind: 'ok',
              durationMs: Date.now() - startedAt,
              stdoutTail: lastLines(stdout, 5),
              smokeOutputs,
            })
          })()
          return
        }
        resolve({ kind: 'ok', durationMs, stdoutTail: lastLines(stdout, 5) })
        return
      }

      const kind = classify(stdout, stderr)
      const stderrSnippet = lastLines(stderr, 20)
      if (kind === 'other') {
        resolve({
          kind,
          exitCode: code ?? -1,
          durationMs,
          stderrSnippet,
          stdoutTail: lastLines(stdout, 10),
        })
      } else {
        resolve({ kind, durationMs, stderrSnippet } as DeployOutcome)
      }
    })
  })
}

/** Convenience wrapper for bench: deploy the composed tree from a ComposeResult. */
export async function deployComposed(composed: ComposeResult, opts: Omit<DeployOptions, 'source'> = {}): Promise<DeployOutcome> {
  return deploy({ source: composed.outputDir, ...opts })
}

/**
 * Pushes a near-empty convex/ tree (one placeholder table, no functions)
 * to clear residual schema + function state from prior tests. The next
 * deploy's diff is then "0 → N" (pure additions), not "M → N" — which
 * matters because finish_push commits the diff in a single transaction
 * bounded by the 4096 read-interval cap. Diff-stacking between
 * sequential tests at high N can spuriously trip TooManyReads even when
 * the target deploy itself would have fit a clean budget.
 *
 * Reset takes ~3–5 s. Useful between flavor/N tests in a sweep.
 */
export async function resetDeployment(opts: { verbose?: boolean } = {}): Promise<DeployOutcome> {
  // Materialize a placeholder source tree we deploy. Outside of
  // _deploy/convex/ so stageSource doesn't try to read it as our compose
  // target.
  const resetSrcDir = join(DEPLOY_DIR, '_reset')
  mkdirSync(resetSrcDir, { recursive: true })
  writeFileSync(
    join(resetSrcDir, 'schema.ts'),
    `import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'
export default defineSchema({
  scaffold: defineTable({ x: v.string() }),
})
`,
  )
  return deploy({ source: resetSrcDir, verbose: opts.verbose, timeoutMs: 2 * 60 * 1000 })
}

// CLI: bun run realDeploy.ts --source=<dir> [--timeout=300000]
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const get = (k: string) => args.find(a => a.startsWith(`--${k}=`))?.split('=')[1]
  const source = get('source')
  if (!source) throw new Error('--source=<convex-dir> required')
  const timeoutMs = get('timeout') ? Number(get('timeout')) : undefined
  const outcome = await deploy({ source, timeoutMs })
  console.log(JSON.stringify(outcome, null, 2))
  process.exit(outcome.kind === 'ok' ? 0 : 1)
}
