// Environment metadata + cell fingerprinting for the stress harness.
//
// Metadata: every results file should record exactly what produced it —
// convex-backend behavior changes flip results wholesale (see
// get-convex/convex-backend#414: the entire March-2026 whole-app-analysis
// OOM class vanished when Convex moved to per-entrypoint analysis), so a
// number without its convex version + zodvex commit is not comparable.
//
// Fingerprinting: real-deploy cells are expensive, and the parity flavors
// (convex / convex-helpers / convex-helpers-zod3) only change when THEIR
// inputs change — not on every zodvex edit. A cell whose fingerprint
// matches a cached entry is skipped (pass --force to re-run). Revives the
// legacy harness's cache (4f58a49) for the sweep.

import { execSync } from 'child_process'
import { createHash, type Hash } from 'crypto'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = __dirname
const REPO_ROOT = join(ROOT, '..', '..')

/** Bump when the fingerprint structure itself changes. */
const FINGERPRINT_SCHEMA = 'v1'

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export interface HarnessMeta {
  timestamp: string
  gitSha: string
  gitDirty: boolean
  zodvexVersion: string
  convexVersion: string
  convexHelpersVersion: string
  zodVersion: string
  bunVersion: string
  deployment: string | null
}

function pkgVersion(name: string): string {
  try {
    const p = join(ROOT, 'node_modules', name, 'package.json')
    const fallback = join(REPO_ROOT, 'node_modules', name, 'package.json')
    const file = existsSync(p) ? p : fallback
    return JSON.parse(readFileSync(file, 'utf-8')).version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

function git(cmd: string): string {
  try {
    return execSync(`git ${cmd}`, { cwd: REPO_ROOT, encoding: 'utf-8' }).trim()
  } catch {
    return 'unknown'
  }
}

function deploymentSlug(): string | null {
  const envFile = join(ROOT, '_deploy', '.env.local')
  if (process.env.CONVEX_DEPLOYMENT) return process.env.CONVEX_DEPLOYMENT
  if (!existsSync(envFile)) return null
  const m = readFileSync(envFile, 'utf-8').match(/CONVEX_DEPLOYMENT=([^\s#]+)/)
  return m?.[1] ?? null
}

export function collectMeta(): HarnessMeta {
  return {
    timestamp: new Date().toISOString(),
    gitSha: git('rev-parse HEAD'),
    gitDirty: git('status --porcelain') !== '',
    zodvexVersion: JSON.parse(
      readFileSync(join(REPO_ROOT, 'packages', 'zodvex', 'package.json'), 'utf-8')
    ).version,
    convexVersion: pkgVersion('convex'),
    convexHelpersVersion: pkgVersion('convex-helpers'),
    zodVersion: pkgVersion('zod'),
    bunVersion: (globalThis as any).Bun?.version ?? process.version,
    deployment: deploymentSlug()
  }
}

// ---------------------------------------------------------------------------
// Fingerprinting
// ---------------------------------------------------------------------------

function hashPath(p: string, h: Hash): void {
  if (!existsSync(p)) {
    h.update(`missing:${p}`)
    return
  }
  const st = statSync(p)
  if (st.isDirectory()) {
    for (const entry of readdirSync(p).sort()) {
      if (entry === 'node_modules' || entry === 'tmp' || entry.startsWith('.')) continue
      hashPath(join(p, entry), h)
    }
    return
  }
  h.update(p.slice(ROOT.length))
  h.update(readFileSync(p))
}

export interface CellKey {
  flavor: string
  shape: string
  n: number
}

/**
 * Fingerprint everything that can change a cell's outcome. Parity flavors
 * exclude the zodvex dist, so zodvex development doesn't invalidate their
 * cached baselines.
 */
export function fingerprintCell(key: CellKey, meta: HarnessMeta): string {
  const h = createHash('sha256')
  h.update(FINGERPRINT_SCHEMA)
  h.update(JSON.stringify(key))
  h.update(meta.deployment ?? 'no-deployment')
  h.update(`convex:${meta.convexVersion}|helpers:${meta.convexHelpersVersion}|zod:${meta.zodVersion}`)

  // Harness logic — any change to compose/deploy/measure invalidates.
  for (const f of ['compose.ts', 'sweep.ts', 'bench.ts', 'realDeploy.ts', 'bundle.ts', 'measureBundle.ts', 'measureChild.mjs']) {
    hashPath(join(ROOT, f), h)
  }

  // Seed corpus for the flavor (zodvex-mini shares zodvex seeds).
  const seedFlavor = key.flavor === 'zodvex-mini' ? 'zodvex' : key.flavor
  hashPath(join(ROOT, 'seeds', seedFlavor), h)

  // zodvex flavors depend on the built workspace dist (library + CLI).
  if (key.flavor === 'zodvex' || key.flavor === 'zodvex-mini') {
    hashPath(join(REPO_ROOT, 'packages', 'zodvex', 'dist'), h)
    if (key.flavor === 'zodvex-mini') {
      hashPath(join(REPO_ROOT, 'packages', 'zod-to-mini', 'dist'), h)
    }
  }

  return h.digest('hex')
}

// ---------------------------------------------------------------------------
// Cell cache
// ---------------------------------------------------------------------------

const CACHE_FILE = join(ROOT, 'results', '.cell-cache.json')

export interface CachedCell {
  outcome: string
  durationMs: number
  endpointHeapMaxMB: number
  schemaHeapMB: number | null
  errorTail: string | null
  cachedAt: string
  key: CellKey
}

export function loadCellCache(): Record<string, CachedCell> {
  try {
    return JSON.parse(readFileSync(CACHE_FILE, 'utf-8'))
  } catch {
    return {}
  }
}

export function saveCellCache(cache: Record<string, CachedCell>): void {
  mkdirSync(dirname(CACHE_FILE), { recursive: true })
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2))
}
