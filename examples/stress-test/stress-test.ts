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
 *   bun run stress-test -- --count=200  # single point, all variants
 *   bun run stress-test -- --convex     # one variant
 *   bun run stress-test -- --compile
 */
import { execFileSync, spawnSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, cpSync, rmSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { transformCode, transformImports } from 'zod-to-mini'
import { Project } from 'ts-morph'
import { compose, type Flavor } from './compose'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const CONVEX_DIR = join(ROOT, 'convex')
const RESULTS_DIR = join(ROOT, 'results')
const ZODVEX_CLI = join(ROOT, '..', '..', 'packages', 'zodvex', 'dist', 'cli', 'index.js')

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
    baselineOnly: args.includes('--baseline')
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
    { name: 'zod + compile', flavor: 'zodvex', slim: false, mini: false, codegen: false, compile: true },
    { name: 'mini', flavor: 'zodvex', slim: false, mini: true, codegen: false, compile: false }
  ]
}

function zodvexVariantName(slim: boolean, mini: boolean, codegen: boolean, compile: boolean): string {
  const parts: string[] = [mini ? 'mini' : 'zod']
  if (slim) parts.push('slim')
  if (codegen) parts.push('codegen')
  if (compile) parts.push('compile')
  return parts.join(' + ')
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
  execFileSync('bun', cmd.split(' '), { cwd: ROOT, stdio: 'pipe', timeout: 180_000 })
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

const KNOWN_OOM_PATTERNS = [
  /isolate.*memory/i,
  /memory.*limit/i,
  /heap out of memory/i,
  /JavaScript heap/i,
  /size limit/i,
  /module.*too large/i,
  /push.*failed.*bundle/i
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

function pushOnce(deployKey: string, timeoutMs = 240_000): PushResult {
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

function findCeiling(variant: Variant, deployKey: string): { ceiling: number; points: CeilingPoint[] } {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`Searching ceiling for: ${variant.name}`)
  console.log('='.repeat(60))

  const points: CeilingPoint[] = []
  let lastGood = 0

  // Coarse pass: doubling. Convex baseline is the only one expected to push
  // through the multi-thousand range, so we go up to 4k for it; others cap
  // earlier (saves real-deploy minutes).
  const coarseCap = variant.flavor === 'convex' ? 4000 : variant.compile ? 2000 : 1000
  let hi = coarseCap
  for (let count = 50; count <= coarseCap; count = Math.min(coarseCap, Math.floor(count * 1.6))) {
    const p = pushAtCount(count, variant, deployKey)
    points.push(p)
    console.log(`  ${count}: ${p.pushed ? `pushed in ${(p.durationMs / 1000).toFixed(1)}s` : `FAILED (${p.errorKind})\n    ${p.errorSnippet?.split('\n').join('\n    ')}`}`)
    if (p.pushed) {
      lastGood = count
      if (count === coarseCap) {
        console.log(`  → reached probe cap at ${coarseCap} without failure`)
        return { ceiling: lastGood, points }
      }
    } else {
      hi = count
      break
    }
  }

  if (lastGood === 0) {
    console.log('  → could not push even the smallest seed count; bailing.')
    return { ceiling: 0, points }
  }

  // Fine pass: binary search.
  let lo = lastGood
  while (hi - lo > 25) {
    const mid = Math.round((lo + hi) / 2)
    const p = pushAtCount(mid, variant, deployKey)
    points.push(p)
    console.log(`  ${mid}: ${p.pushed ? 'pushed' : `over (${p.errorKind})`}`)
    if (p.pushed) { lo = mid; lastGood = mid }
    else hi = mid
  }
  console.log(`  → ceiling: ${lastGood} endpoints`)
  return { ceiling: lastGood, points }
}

// --- Report ---

function writeReport(
  results: { variant: string; ceiling: number; points: CeilingPoint[] }[],
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
      'Each row is the largest endpoint count that successfully pushes via',
      '`npx convex deploy` against a real Convex dev deployment, found by',
      'doubling-then-binary-search. A failed push (OOM, bundle size, or other)',
      'sets the upper bound; the next probe halves the range.',
      '',
      '| Variant | Max Endpoints |',
      '|---------|--------------|'
    )
    for (const r of results) lines.push(`| ${r.variant} | ${r.ceiling} |`)

    lines.push('', '## All probes', '')
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
  const results: { variant: string; ceiling: number; points: CeilingPoint[] }[] = []
  for (const v of variants) {
    const r = findCeiling(v, deployKey)
    results.push({ variant: v.name, ceiling: r.ceiling, points: r.points })
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
