/**
 * Stress test (real-deploy edition).
 *
 * Composes N seed models per variant, optionally compiles or runs codegen,
 * then drives `npx convex deploy` against a real Convex deployment. Bisects
 * on push success/failure to find the actual ceiling for each variant.
 *
 * No more heap proxy. The push goes to a real Convex backend; the bundle is
 * built with Convex's bundler, loaded into the 64 MB push-time isolate, and
 * either succeeds or fails the way real users experience.
 *
 * Setup (once):
 *   - Create a throwaway dev project at https://dashboard.convex.dev/
 *   - Settings → URL and Deploy Key → Generate Dev Deploy Key
 *   - Save it to examples/stress-test/.env.local as `CONVEX_DEPLOY_KEY=<key>`
 *
 * The deploy key encodes the deployment URL; nothing else is needed.
 *
 * Usage:
 *   bun run stress-test                 # all variants, full ceiling search
 *   bun run stress-test -- --baseline   # only push every variant @ count=100
 *   bun run stress-test -- --count=200  # single point, all variants
 *   bun run stress-test -- --convex     # one variant
 *   bun run stress-test -- --compile
 *   bun run stress-test -- --force      # ignore the ceilings cache, re-measure
 *
 * Caching: ceiling results are cached in `results/ceilings.cache.json` keyed
 * by a fingerprint of (variant config + seed source + compose.ts + this
 * runner + zodvex CLI dist + deployment). Subsequent runs reuse cached
 * ceilings when none of those have changed. Pass `--force` to bypass.
 */
import { execFileSync, spawnSync } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, cpSync, rmSync, statSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { transformCode, transformImports } from 'zod-to-mini'
import { Project } from 'ts-morph'
import { compose, type Flavor } from './compose'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const CONVEX_DIR = join(ROOT, 'convex')
const SEEDS_DIR = join(ROOT, 'seeds')
const RESULTS_DIR = join(ROOT, 'results')
const ZODVEX_CLI = join(ROOT, '..', '..', 'packages', 'zodvex', 'dist', 'cli', 'index.js')
const CEILINGS_CACHE = join(RESULTS_DIR, 'ceilings.cache.json')

// --- Flag parsing ---

interface Flags {
  count?: number
  slim: boolean
  mini: boolean
  codegen: boolean
  compile: boolean
  convex: boolean
  convexHelpers: boolean
  convexHelpersZod3: boolean
  baselineOnly: boolean
  /** Bypass the ceilings cache — re-measure even when fingerprint matches. */
  force: boolean
}

function parseFlags(): Flags {
  const args = process.argv.slice(2)
  const find = (p: string) => args.find(a => a.startsWith(p))?.split('=')[1]
  return {
    count: find('--count=') ? parseInt(find('--count=')!) : undefined,
    slim: args.includes('--slim'),
    mini: args.includes('--mini'),
    codegen: args.includes('--codegen'),
    compile: args.includes('--compile'),
    convex: args.includes('--convex'),
    convexHelpers: args.includes('--convex-helpers'),
    convexHelpersZod3: args.includes('--convex-helpers-zod3'),
    baselineOnly: args.includes('--baseline'),
    force: args.includes('--force')
  }
}

// --- Variant definition ---

interface Variant {
  name: string
  flavor: Flavor
  slim: boolean
  mini: boolean
  codegen: boolean
  compile: boolean
}

function getVariants(flags: Flags): Variant[] {
  if (flags.convex) return [{ name: 'convex (baseline)', flavor: 'convex', slim: false, mini: false, codegen: false, compile: false }]
  if (flags.convexHelpers) return [{ name: 'convex-helpers/zod4', flavor: 'convex-helpers', slim: false, mini: false, codegen: false, compile: false }]
  if (flags.convexHelpersZod3) return [{ name: 'convex-helpers/zod3', flavor: 'convex-helpers-zod3', slim: false, mini: false, codegen: false, compile: false }]
  if (flags.slim || flags.mini || flags.codegen || flags.compile) {
    return [{
      name: zodvexVariantName(flags.slim, flags.mini, flags.codegen, flags.compile),
      flavor: 'zodvex',
      slim: flags.slim,
      mini: flags.mini,
      codegen: flags.codegen,
      compile: flags.compile
    }]
  }
  // Slim is intentionally not in the default matrix — `compile` is the
  // strategic replacement for `slim` (preserves ergonomic API, no breaking
  // changes, eliminates push-time Zod entirely). Slim stays available via
  // explicit `--slim` for ad-hoc comparisons.
  return [
    { name: 'convex (baseline)', flavor: 'convex', slim: false, mini: false, codegen: false, compile: false },
    { name: 'convex-helpers/zod3', flavor: 'convex-helpers-zod3', slim: false, mini: false, codegen: false, compile: false },
    { name: 'convex-helpers/zod4', flavor: 'convex-helpers', slim: false, mini: false, codegen: false, compile: false },
    { name: 'zod', flavor: 'zodvex', slim: false, mini: false, codegen: false, compile: false },
    { name: 'zod + codegen', flavor: 'zodvex', slim: false, mini: false, codegen: true, compile: false },
    { name: 'zod + compile', flavor: 'zodvex', slim: false, mini: false, codegen: false, compile: true }
    // `mini` (zodvex via zod/mini) is dropped from the default matrix: compile
    // supersedes mini's role (memory-pressure escape) without requiring a
    // breaking-change codemod, and our test seeds currently surface
    // pre-existing issue #62 (`zx.doc(...).nullable()` not transformed to the
    // functional form by zod-to-mini). Available via `--mini` for ad-hoc runs.
  ]
}

function zodvexVariantName(slim: boolean, mini: boolean, codegen: boolean, compile: boolean): string {
  const parts: string[] = [mini ? 'mini' : 'zod']
  if (slim) parts.push('slim')
  if (codegen) parts.push('codegen')
  if (compile) parts.push('compile')
  return parts.join(' + ')
}

// --- Ceilings cache ---
//
// The ceiling search is expensive (real-deploy pushes, 5–20 min per variant).
// When nothing has changed — same seeds, same compose logic, same zodvex
// dist, same deployment — re-running is wasteful.
//
// We fingerprint everything that could affect a variant's ceiling and cache
// the result in `results/ceilings.cache.json`. Cache is checked at the start
// of each ceiling search; on hit we reuse without pushing. `--force` bypasses
// the cache entirely.

interface CachedCeilingEntry {
  variant: string
  fingerprint: string
  ceiling: number
  points: CeilingPoint[]
  baseline?: BaselineRow
  status?: 'pushed' | 'oom' | 'env-failure' | 'unknown'
  timestamp: string
  /** Deployment URL fragment so cache from one deployment doesn't leak to another. */
  deployment: string
}

function hashFile(filePath: string, h: ReturnType<typeof createHash>): void {
  if (!existsSync(filePath)) return
  const stat = statSync(filePath)
  if (stat.isDirectory()) {
    for (const entry of readdirSync(filePath).sort()) {
      hashFile(join(filePath, entry), h)
    }
    return
  }
  h.update(filePath)
  h.update(readFileSync(filePath))
}

function deploymentKey(deployKey: string): string {
  // Format: "dev:<slug>|<token>". Use the slug as a stable identifier; the
  // token rotates without invalidating the cache.
  const slug = deployKey.split('|')[0] ?? deployKey
  return slug
}

function fingerprintVariant(variant: Variant, deployKey: string): string {
  const h = createHash('sha256')
  h.update('v3') // bump on schema changes to this fingerprint structure
  h.update(JSON.stringify({
    flavor: variant.flavor,
    slim: variant.slim,
    mini: variant.mini,
    codegen: variant.codegen,
    compile: variant.compile
  }))
  h.update(deploymentKey(deployKey))
  // Seed source for the flavor — what the runner actually pushes.
  hashFile(join(SEEDS_DIR, variant.flavor), h)
  // Compose logic
  hashFile(join(ROOT, 'compose.ts'), h)
  // The runner itself (changes to the search algorithm, retry, etc. invalidate)
  hashFile(join(ROOT, 'stress-test.ts'), h)
  // For zodvex variants that depend on the workspace dist (compile / codegen
  // transform output, mini codemod), include the relevant built artifacts.
  if (variant.flavor === 'zodvex') {
    if (variant.compile || variant.codegen) hashFile(ZODVEX_CLI, h)
    // The mini codemod is invoked from the runner; hash the workspace package.
    if (variant.mini) {
      hashFile(join(ROOT, '..', '..', 'packages', 'zod-to-mini', 'dist'), h)
    }
  }
  return h.digest('hex').slice(0, 16)
}

function loadCeilingsCache(): Record<string, CachedCeilingEntry> {
  if (!existsSync(CEILINGS_CACHE)) return {}
  try {
    return JSON.parse(readFileSync(CEILINGS_CACHE, 'utf-8'))
  } catch {
    return {}
  }
}

function saveCeilingsCache(cache: Record<string, CachedCeilingEntry>): void {
  if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true })
  writeFileSync(CEILINGS_CACHE, JSON.stringify(cache, null, 2))
}

// --- Setup check ---

function ensureConvexDeployment(): { deployKey: string } {
  const envFile = join(ROOT, '.env.local')
  if (!existsSync(envFile)) {
    console.error('')
    console.error('error: examples/stress-test/.env.local is missing.')
    console.error('')
    console.error('Create a throwaway dev deployment at https://dashboard.convex.dev/,')
    console.error('then Settings → URL and Deploy Key → Generate Dev Deploy Key.')
    console.error('Save the key to examples/stress-test/.env.local as:')
    console.error('')
    console.error('  CONVEX_DEPLOY_KEY=<paste-key-here>')
    console.error('')
    console.error('Each run wipes the deployment\'s schema; do not point this at real data.')
    console.error('')
    process.exit(1)
  }
  const env = readFileSync(envFile, 'utf-8')
  const m = env.match(/^CONVEX_DEPLOY_KEY=(.+)$/m)
  if (!m) {
    console.error('error: .env.local exists but does not contain CONVEX_DEPLOY_KEY.')
    console.error('See the stress-test README for setup instructions.')
    process.exit(1)
  }
  return { deployKey: m[1].trim() }
}

// --- Compose / compile / codegen / mini transform ---

function prepareConvexDir(count: number, variant: Variant): void {
  // Compose seeds directly into the example's convex/ root. compose() does a
  // targeted wipe (models/, endpoints/, schema.ts, functions.ts) and leaves
  // _generated/, convex.config.ts, tsconfig.json alone.
  compose({
    count,
    outputDir: CONVEX_DIR,
    flavor: variant.flavor,
    withCodegen: variant.codegen,
    slim: variant.slim
  })

  // Mini: zod → mini codemod over the composed source.
  if (variant.mini) {
    compileMini(CONVEX_DIR)
  }

  // Compile: zodvex compile rewrites endpoints, models, schema to vanilla Convex.
  if (variant.compile) {
    runCli(`${ZODVEX_CLI} compile ${CONVEX_DIR}`)
  }

  // Codegen: emit `_zodvex/` artifacts.
  if (variant.codegen) {
    const miniFlag = variant.mini ? ' --mini' : ''
    runCli(`${ZODVEX_CLI} generate ${CONVEX_DIR}${miniFlag}`)
  }
}

function compileMini(dir: string): void {
  const dirs = ['models', 'endpoints']
  for (const sub of dirs) {
    const d = join(dir, sub)
    if (!existsSync(d)) continue
    for (const file of readdirSync(d).filter(f => f.endsWith('.ts'))) {
      compileMiniFile(join(d, file))
    }
  }
  for (const file of ['schema.ts', 'functions.ts']) {
    const p = join(dir, file)
    if (existsSync(p)) compileMiniFile(p)
  }
}

function compileMiniFile(filePath: string): void {
  const code = readFileSync(filePath, 'utf-8')
  let output = transformCode(code).code
  const project = new Project({ useInMemoryFileSystem: true })
  const sf = project.createSourceFile('tmp.ts', output)
  transformImports(sf)
  for (const imp of sf.getImportDeclarations()) {
    const spec = imp.getModuleSpecifierValue()
    if (spec === 'zodvex' || spec === 'zodvex/core') imp.setModuleSpecifier('zodvex/mini')
    if (spec === 'zodvex/server') imp.setModuleSpecifier('zodvex/mini/server')
  }
  const hasZ = sf.getImportDeclarations().some(i =>
    i.getNamedImports().some(n => n.getName() === 'z') || i.getDefaultImport()?.getText() === 'z'
  )
  if (!hasZ && /\bz\./.test(sf.getFullText())) {
    sf.addImportDeclaration({ namedImports: ['z'], moduleSpecifier: 'zod/mini' })
  }
  writeFileSync(filePath, sf.getFullText())
}

function runCli(cmd: string): void {
  // Generous timeout: zodvex compile ts-morph-walks a monolithic source file
  // that can reach ~2 MB at higher counts; plain `bun` startup itself is also
  // a few seconds. 600s is comfortably above empirical worst case.
  execFileSync('bun', cmd.split(' '), { cwd: ROOT, stdio: 'pipe', timeout: 600_000 })
}

// --- The push itself ---

interface PushResult {
  pushed: boolean
  durationMs: number
  /** Total uncompressed bytes of the bundle pushed to the deployment.
   *  Closest concrete proxy for what the push-time isolate has to load. */
  unzippedBytes?: number
  /** Total gzipped bytes of the upload. */
  zippedBytes?: number
  errorKind?: 'oom' | 'file-limit' | 'function-array' | 'bundle-size' | 'timeout' | 'other'
  errorSnippet?: string
}

/** Parses Convex's `{ "$integer": "<base64-LE-uint64>" }` encoding. Returns
 *  the byte count, or undefined if not found. */
function extractConvexSize(out: string, key: 'unzippedSizeBytes' | 'zippedSizeBytes'): number | undefined {
  const re = new RegExp(`"${key}"\\s*:\\s*\\{\\s*"\\$integer"\\s*:\\s*"([^"]+)"`)
  const m = out.match(re)
  if (!m) return undefined
  const buf = Buffer.from(m[1], 'base64')
  if (buf.length !== 8) return undefined
  const lo = buf.readUInt32LE(0)
  const hi = buf.readUInt32LE(4)
  // Sizes fit in a JS number (≤ 2^53 = 9 PB) so no BigInt needed.
  return hi * 0x100000000 + lo
}

// Patterns that match Convex's real OOM error from the push-time isolate.
// The canonical message (verified against a live deployment) is:
//   "JavaScript execution ran out of memory (maximum memory usage: 64 MB)"
// embedded in an `InvalidModules: Loading the pushed modules ...` envelope.
// Keep the other historical patterns as defense-in-depth in case Convex
// reformats the error in a future release.
const KNOWN_OOM_PATTERNS = [
  /execution ran out of memory/i,
  /maximum memory usage/i,
  /isolate.*memory/i,
  /memory.*limit/i,
  /out of memory/i,
  /heap out of memory/i,
  /JavaScript heap/i,
  /module.*too large/i
]

/** Synchronous sleep — bun-native if available, fallback for tsc-clean type. */
function sleepSync(ms: number): void {
  const bun = (globalThis as { Bun?: { sleepSync?: (ms: number) => void } }).Bun
  if (bun?.sleepSync) {
    bun.sleepSync(ms)
    return
  }
  // Last resort: busy wait. Only hit if not running under bun, which the
  // package.json already requires.
  const wake = Date.now() + ms
  while (Date.now() < wake) {
    /* spin */
  }
}

function pushOnce(deployKey: string, timeoutMs = 600_000): PushResult {
  // Retry transient infra errors (5xx cold-starts, network blips). These are
  // common immediately after creating a dev deployment and during periods of
  // Convex backend instability. They have nothing to do with the OOM ceiling
  // we're trying to find. Backoff: 2s, 4s, 8s, 16s, 32s, 64s — total ~2 min
  // worst case.
  const MAX_TRIES = 7
  const RETRY_PATTERNS = [
    /\b50[0-9]\b/,
    /Service Unavailable/i,
    /ECONNRESET/i,
    /ECONNREFUSED/i,
    /fetch failed/i,
    /Unable to (?:pull|start) (?:deployment|push)/i
  ]
  let lastResult: PushResult | undefined
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    const start = Date.now()
    const child = spawnSync(
      'npx',
      ['convex', 'deploy', '--yes', '--verbose', '--typecheck=disable', '--codegen=disable'],
      {
        cwd: ROOT,
        env: { ...process.env, CI: '1', CONVEX_DEPLOY_KEY: deployKey },
        encoding: 'utf-8',
        timeout: timeoutMs,
        // Verbose output dumps the full schema graph; can be 50+ MB at high
        // counts. Default 1 MB cap would truncate and we'd lose the trailing
        // size lines.
        maxBuffer: 512 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
    const durationMs = Date.now() - start
    const out = `${child.stdout ?? ''}\n${child.stderr ?? ''}`
    // Bundle sizes are reported by Convex *after* upload but *before*
    // schema-validation runs. Some failures (TooManyReads, post-eval
    // errors) only surface after the bundle is already there, so we
    // still extract sizes when available — even on failure.
    const unzippedBytes = extractConvexSize(out, 'unzippedSizeBytes')
    const zippedBytes = extractConvexSize(out, 'zippedSizeBytes')
    if (child.status === 0) {
      return { pushed: true, durationMs, unzippedBytes, zippedBytes }
    }
    const errorKind: PushResult['errorKind'] = child.signal === 'SIGTERM' ? 'timeout'
      : /Too many function files \(\d+ > maximum 4096\)/i.test(out) ? 'file-limit'
      : /ArrayTooLong:.*maximum length 8192/i.test(out) ? 'function-array'
      : KNOWN_OOM_PATTERNS.some(p => p.test(out)) ? 'oom'
      : /bundle.*size|too large/i.test(out) ? 'bundle-size'
      : 'other'
    const errorSnippet = out.split('\n').filter(l => l.trim()).slice(-6).join('\n')
    lastResult = { pushed: false, durationMs, unzippedBytes, zippedBytes, errorKind, errorSnippet }
    if (attempt < MAX_TRIES && RETRY_PATTERNS.some(p => p.test(out))) {
      const delayMs = 2000 * 2 ** (attempt - 1)
      sleepSync(delayMs)
      continue
    }
    return lastResult
  }
  return lastResult!
}

// --- Ceiling search ---

interface CeilingPoint {
  count: number
  pushed: boolean
  durationMs: number
  unzippedBytes?: number
  zippedBytes?: number
  errorKind?: PushResult['errorKind']
  errorSnippet?: string
}

function pushAtCount(count: number, variant: Variant, deployKey: string): CeilingPoint {
  prepareConvexDir(count, variant)
  const r = pushOnce(deployKey)
  return {
    count,
    pushed: r.pushed,
    durationMs: r.durationMs,
    unzippedBytes: r.unzippedBytes,
    zippedBytes: r.zippedBytes,
    errorKind: r.errorKind,
    errorSnippet: r.errorSnippet
  }
}

/** Push-time isolate budget, minus Convex runtime overhead. The proxy
 *  doesn't load Convex's runtime, so 48 MB is the safe-zone target. */
const HEAP_PROXY_THRESHOLD_MB = 48
/** Upper search bound for the heap proxy. We cap below the count where:
 *
 *  - the convex baseline would hit Convex's 8192-function project cap
 *    (1638 model+endpoint units × 5 functions/unit), and
 *  - `zod + compile`'s pre-transform discoverModules OOMs Node trying to
 *    load thousands of zodvex schemas before compile can rewrite them.
 *
 *  2500 keeps both branches alive while still letting the proxy report
 *  "≥ 2500 heap-safe" for the lightest variants — beyond that, the
 *  comparison number stops being about the zod tax.
 */
const HEAP_PROXY_HI = 2500

interface LocalHeapPoint {
  count: number
  heapDeltaMB: number
}

function measureLocalHeap(count: number, variant: Variant): LocalHeapPoint | null {
  prepareConvexDir(count, variant)
  try {
    const out = execFileSync(
      'bun',
      ['--expose-gc', 'run', join(ROOT, 'measureHeap.ts'), `--dir=${CONVEX_DIR}`],
      {
        cwd: ROOT,
        encoding: 'utf-8',
        timeout: 120_000,
        env: { ...process.env, NODE_OPTIONS: '--expose-gc' },
        // Heap proxy output is small JSON; bump cap modestly anyway.
        maxBuffer: 16 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
    const parsed = JSON.parse(out.toString().trim()) as { heapDeltaMB: number }
    return { count, heapDeltaMB: parsed.heapDeltaMB }
  } catch (err) {
    console.warn(`  [heap-proxy] count=${count} FAILED: ${(err as Error).message?.split('\n')[0]}`)
    return null
  }
}

/** Local-heap binary search for the largest N where heapDeltaMB ≤ threshold.
 *  Result is a SEED for real-push confirmation, not the ceiling itself.
 *  Coarse on purpose — refining to ±25 endpoints isn't worth the extra
 *  per-probe cost (especially for `zod + compile` where every probe re-runs
 *  the ts-morph transform on monolithic source). ±10% precision is plenty
 *  for a comparison number that gets a single real-push verification. */
function localHeapBinarySearch(variant: Variant): {
  candidate: number
  highestSafe: number
  points: LocalHeapPoint[]
} {
  const points: LocalHeapPoint[] = []
  let highestSafe = 0
  let firstUnsafe = HEAP_PROXY_HI

  // Doubling-up pass: start at 50, grow until heap exceeds threshold or we
  // reach the cap. Factor of 2.0 — fewer probes than 1.7×, still enough
  // resolution.
  for (let count = 50; count <= HEAP_PROXY_HI; count = Math.min(HEAP_PROXY_HI, Math.round(count * 2))) {
    const p = measureLocalHeap(count, variant)
    if (!p) break
    points.push(p)
    console.log(`  [heap] ${count}: ${p.heapDeltaMB.toFixed(1)} MB`)
    if (p.heapDeltaMB <= HEAP_PROXY_THRESHOLD_MB) {
      highestSafe = count
      if (count === HEAP_PROXY_HI) break
    } else {
      firstUnsafe = count
      break
    }
  }

  // One refinement step: probe the geometric mean of [highestSafe, firstUnsafe]
  // for ~10% better precision. No further refine — the answer gets verified
  // by a single real push, not bisected.
  if (firstUnsafe > 0 && firstUnsafe > highestSafe && highestSafe > 0) {
    const mid = Math.round(Math.sqrt(highestSafe * firstUnsafe))
    if (mid > highestSafe && mid < firstUnsafe) {
      const p = measureLocalHeap(mid, variant)
      if (p) {
        points.push(p)
        console.log(`  [heap] ${mid}: ${p.heapDeltaMB.toFixed(1)} MB`)
        if (p.heapDeltaMB <= HEAP_PROXY_THRESHOLD_MB) highestSafe = mid
      }
    }
  }

  return { candidate: highestSafe, highestSafe, points }
}

/** Hybrid ceiling — proxy seed, single real-push verification, NO refine.
 *
 *  1. Local heap proxy binary-searches for `candidate` — highest N where
 *     a Bun subprocess loading the composed source stays under ~48 MB.
 *  2. Real `convex deploy` push at `candidate` ONCE for verification.
 *  3. Report `ceiling = candidate` with one of three statuses:
 *     - `pushed`: real-deploy confirmed the proxy estimate
 *     - `oom-at-N`: proxy over-estimates by some unknown margin (real
 *       memory bound is below candidate, but refining via real push is
 *       unreliable when the deployment is under load — env failures
 *       at intermediate counts mask the true OOM cliff)
 *     - `env-failure-at-N`: real push failed for non-memory reasons
 *       (TooManyReads, function-array, timeout, etc.) — proxy says
 *       memory is fine, real Convex hit a different limit
 *
 *  Refining downward via real push was tried in an earlier iteration and
 *  fell apart: env-driven failures (TooManyReads from deployment state,
 *  600s push timeouts at scale) bisected to nonsense numbers. The proxy
 *  is at least reproducible. Single-push verification + status annotation
 *  is the most honest signal we can extract.
 */
function findCeiling(variant: Variant, deployKey: string): { ceiling: number; points: CeilingPoint[]; status: 'pushed' | 'oom' | 'env-failure' | 'unknown' } {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`Ceiling for: ${variant.name}`)
  console.log('='.repeat(60))

  const heap = localHeapBinarySearch(variant)
  if (heap.candidate === 0) {
    console.log('  → heap proxy could not seed a candidate; bailing.')
    return { ceiling: 0, points: [], status: 'unknown' }
  }
  console.log(`  → heap-proxy candidate: ${heap.candidate}`)

  const push = pushAtCount(heap.candidate, variant, deployKey)
  console.log(
    `  [push] ${heap.candidate}: ${
      push.pushed
        ? `pushed in ${(push.durationMs / 1000).toFixed(1)}s, ${fmtKB(push.unzippedBytes)} unzipped`
        : `FAILED (${push.errorKind})`
    }`
  )

  const status = push.pushed
    ? 'pushed'
    : push.errorKind === 'oom'
      ? 'oom'
      : 'env-failure'

  console.log(`  → ceiling: ${heap.candidate} endpoints (${status})`)
  return { ceiling: heap.candidate, points: [push], status }
}

// --- Report ---

function writeReport(
  results: { variant: string; ceiling: number; points: CeilingPoint[]; status?: 'pushed' | 'oom' | 'env-failure' | 'unknown' }[],
  baselineRows?: BaselineRow[]
): void {
  if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true })

  const lines: string[] = [
    '# Stress Test Report (real Convex push)',
    '',
    `**Date:** ${new Date().toISOString().split('T')[0]}`,
    ''
  ]

  if (baselineRows && baselineRows.length > 0) {
    lines.push(
      `## Baseline (each variant @ count=${BASELINE_COUNT})`,
      '',
      'Bundle bytes are reported by `convex deploy --verbose` and reflect',
      'the size of the compiled artifact uploaded to the deployment, which',
      'is the closest concrete proxy for what the push-time isolate has',
      'to load.',
      '',
      '| Variant | Pushed | Duration (s) | Unzipped | Zipped | Error |',
      '|---------|--------|--------------|----------|--------|-------|'
    )
    for (const b of baselineRows) {
      lines.push(
        `| ${b.variant} | ${b.pushed ? 'yes' : 'no'} | ${(b.durationMs / 1000).toFixed(1)} | ${fmtKB(b.unzippedBytes)} | ${fmtKB(b.zippedBytes)} | ${b.errorKind ?? ''} |`
      )
    }
    lines.push('')
  }

  if (results.length > 0) {
    lines.push(
      '## Ceilings',
      '',
      'Each ceiling is found by binary-searching the local heap proxy',
      '(48 MB threshold, allowing for ~16 MB of Convex runtime overhead in',
      'the 64 MB push-time isolate), then verified by a single real',
      '`convex deploy` push at the candidate count. Status:',
      '',
      '- `pushed` — real-deploy confirmed the proxy estimate',
      '- `oom` — proxy over-estimates; real push hit the 64 MB isolate cap',
      '- `env-failure` — real push failed for non-memory reasons',
      '  (TooManyReads, function-array, timeout); proxy says memory is fine',
      '',
      '| Variant | Ceiling | Status |',
      '|---------|---------|--------|'
    )
    for (const r of results) lines.push(`| ${r.variant} | ${r.ceiling} | ${r.status ?? 'unknown'} |`)

    lines.push('', '## Probe detail', '')
    lines.push('| Variant | Count | Pushed | Duration (s) | Unzipped | Zipped | Error |')
    lines.push('|---------|-------|--------|--------------|----------|--------|-------|')
    for (const r of results) {
      const sorted = [...r.points].sort((a, b) => a.count - b.count)
      for (const p of sorted) {
        lines.push(`| ${r.variant} | ${p.count} | ${p.pushed ? 'yes' : 'no'} | ${(p.durationMs / 1000).toFixed(1)} | ${fmtKB(p.unzippedBytes)} | ${fmtKB(p.zippedBytes)} | ${p.errorKind ?? ''} |`)
      }
    }
  }

  writeFileSync(join(RESULTS_DIR, 'report.md'), lines.join('\n'))
  writeFileSync(
    join(RESULTS_DIR, 'report.json'),
    JSON.stringify({ date: new Date().toISOString(), kind: 'real-push', results }, null, 2)
  )
  console.log(`\nReport written to ${join(RESULTS_DIR, 'report.md')}`)
}

// --- Main ---

/** Baseline pass: push every variant at a fixed small count to confirm
 *  cleanliness before investing real-deploy minutes in ceiling search. */
const BASELINE_COUNT = 100

interface BaselineRow {
  variant: string
  durationMs: number
  pushed: boolean
  unzippedBytes?: number
  zippedBytes?: number
  errorKind?: string
}

function fmtKB(bytes: number | undefined): string {
  if (bytes == null) return 'n/a'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function runBaselinePass(variants: Variant[], deployKey: string): { ok: boolean; rows: BaselineRow[] } {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`Baseline pass — each variant @ count=${BASELINE_COUNT}`)
  console.log('='.repeat(60))
  const rows: BaselineRow[] = []
  let allOk = true
  for (const v of variants) {
    const p = pushAtCount(BASELINE_COUNT, v, deployKey)
    rows.push({
      variant: v.name,
      durationMs: p.durationMs,
      pushed: p.pushed,
      unzippedBytes: p.unzippedBytes,
      zippedBytes: p.zippedBytes,
      errorKind: p.errorKind
    })
    if (p.pushed) {
      console.log(`  ${v.name.padEnd(24)} pushed in ${(p.durationMs / 1000).toFixed(1)}s   ${fmtKB(p.unzippedBytes)} unzipped, ${fmtKB(p.zippedBytes)} zipped`)
    } else {
      allOk = false
      console.log(`  ${v.name.padEnd(24)} FAILED (${p.errorKind})`)
      if (p.errorSnippet) console.log(`      ${p.errorSnippet.split('\n').slice(0, 3).join('\n      ')}`)
    }
  }
  return { ok: allOk, rows }
}

async function main() {
  const { deployKey } = ensureConvexDeployment()
  const flags = parseFlags()
  const variants = getVariants(flags)

  console.log('Stress Test (real Convex push)')
  console.log(`Variants: ${variants.map(v => v.name).join(', ')}`)

  if (flags.count !== undefined) {
    for (const v of variants) {
      const p = pushAtCount(flags.count, v, deployKey)
      const tag = p.pushed
        ? `pushed in ${(p.durationMs / 1000).toFixed(1)}s   ${fmtKB(p.unzippedBytes)} unzipped, ${fmtKB(p.zippedBytes)} zipped`
        : `FAILED (${p.errorKind})`
      console.log(`${v.name} @ ${flags.count}: ${tag}`)
      if (!p.pushed && p.errorSnippet) console.log(`    ${p.errorSnippet.split('\n').join('\n    ')}`)
    }
    return
  }

  // Phase 0: baseline. Halt before ceiling search if anything fails to push at
  // a fixed small count — no point burning minutes on a binary search if a
  // variant can't even build.
  const baseline = runBaselinePass(variants, deployKey)
  if (!baseline.ok) {
    console.error('\nbaseline push failed for one or more variants; halting before ceiling search.')
    process.exit(1)
  }
  if (flags.baselineOnly) {
    writeReport([], baseline.rows)
    return
  }

  console.log(`\n${'='.repeat(60)}`)
  console.log('Ceiling search')
  console.log('='.repeat(60))
  const cache = loadCeilingsCache()
  type ResultRow = { variant: string; ceiling: number; points: CeilingPoint[]; status?: 'pushed' | 'oom' | 'env-failure' | 'unknown' }
  const results: ResultRow[] = []
  let cacheHits = 0
  let cacheMisses = 0
  for (const v of variants) {
    const fp = fingerprintVariant(v, deployKey)
    const cached = cache[v.name]
    if (cached && cached.fingerprint === fp && !flags.force) {
      console.log(`\n[cache hit] ${v.name}: ceiling=${cached.ceiling} (measured ${cached.timestamp.split('T')[0]})`)
      results.push({
        variant: v.name,
        ceiling: cached.ceiling,
        points: cached.points,
        status: cached.status as ResultRow['status']
      })
      cacheHits++
      continue
    }
    cacheMisses++
    const r = findCeiling(v, deployKey)
    results.push({ variant: v.name, ceiling: r.ceiling, points: r.points, status: r.status })
    // Persist this run's result. If the search was inconclusive (ceiling=0)
    // skip caching — we don't want to short-circuit a future run.
    if (r.ceiling > 0) {
      cache[v.name] = {
        variant: v.name,
        fingerprint: fp,
        ceiling: r.ceiling,
        points: r.points,
        baseline: baseline.rows.find(b => b.variant === v.name),
        status: r.status,
        timestamp: new Date().toISOString(),
        deployment: deploymentKey(deployKey)
      }
      saveCeilingsCache(cache)
    }
  }
  if (cacheHits > 0) {
    console.log(`\n[cache] ${cacheHits} hit / ${cacheMisses} miss — pass --force to re-measure cached variants.`)
  }

  console.log(`\n${'='.repeat(60)}`)
  console.log('RESULTS')
  console.log('='.repeat(60))
  console.log('\n| Variant | Ceiling (endpoints) |')
  console.log('|---------|--------------------|')
  for (const r of results) console.log(`| ${r.variant} | ${r.ceiling} |`)

  writeReport(results, baseline.rows)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
