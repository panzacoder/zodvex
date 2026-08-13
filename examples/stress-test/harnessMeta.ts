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
import { pinnedDeploymentSlug } from './realDeploy.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = __dirname
const REPO_ROOT = join(ROOT, '..', '..')

/** Bump when the fingerprint structure itself changes. */
const FINGERPRINT_SCHEMA = 'v3'

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
    // Same source deploy() actually targets — ambient CONVEX_DEPLOYMENT is
    // refused there, so it must not leak into fingerprints either.
    deployment: pinnedDeploymentSlug(),
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

// Subtree digests are stable for the lifetime of one harness process — a
// sweep calls fingerprintCell once per cell, and re-reading the zodvex
// dist (hundreds of files) for every cell is pure waste. A rebuild racing
// a running sweep is out of scope.
const subtreeDigestCache = new Map<string, string>()

function subtreeDigest(p: string): string {
  const hit = subtreeDigestCache.get(p)
  if (hit) return hit
  const h = createHash('sha256')
  hashPath(p, h)
  const digest = h.digest('hex')
  subtreeDigestCache.set(p, digest)
  return digest
}

export interface CellKey {
  flavor: string
  shape: string
  /** Endpoint-file count. */
  n: number
  /** Model (table) count — equals n in the legacy 1:1 sweep. */
  models: number
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
  // sweep.ts is deliberately NOT hashed: it orchestrates and reports but
  // never changes what a cell deploys or measures, and hashing it meant a
  // cosmetic table tweak blew the entire cell cache.
  for (const f of ['compose.ts', 'bench.ts', 'realDeploy.ts', 'bundle.ts', 'measureBundle.ts', 'measureChild.mjs']) {
    h.update(subtreeDigest(join(ROOT, f)))
  }

  // Seed corpus for the flavor (zodvex-mini shares zodvex seeds;
  // convex-helpers-zod3 derives from the convex-helpers corpus).
  const seedFlavor =
    key.flavor === 'zodvex-mini' ? 'zodvex'
    : key.flavor === 'convex-helpers-zod3' ? 'convex-helpers'
    : key.flavor
  h.update(subtreeDigest(join(ROOT, 'seeds', seedFlavor)))

  // zodvex flavors depend on the built workspace dist (library + CLI).
  if (key.flavor === 'zodvex' || key.flavor === 'zodvex-mini') {
    h.update(subtreeDigest(join(REPO_ROOT, 'packages', 'zodvex', 'dist')))
    if (key.flavor === 'zodvex-mini') {
      // src, not dist: the workspace package's main is src/index.ts and it
      // is never built, so compose imports the codemod straight from src.
      h.update(subtreeDigest(join(REPO_ROOT, 'packages', 'zod-to-mini', 'src')))
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

/**
 * Whether a deploy outcome is deterministic enough to cache. Everything the
 * cache replays is treated as authoritative and also feeds skipAfterFailure,
 * so transient failures (timeouts, unclassified 'other' — the bucket network
 * flakes land in, smoke timeouts) must be re-run, never cached. Outcomes
 * that depend on the push diff (ok, too-many-reads) additionally require a
 * clean reset: residual state can shrink the diff (false pass) or stack it
 * (spurious TooManyReads).
 */
export function isCacheableOutcome(
  outcome: { kind: string; stderrSnippet?: string | null },
  resetOk: boolean,
): boolean {
  switch (outcome.kind) {
    // Analysis-isolate and count-based limits: independent of the push diff.
    case 'oom':
    case 'function-limit':
    case 'bundle-limit':
    case 'schema-error':
      return true
    // Diff-dependent: only valid as a fresh-diff claim.
    case 'ok':
    case 'too-many-reads':
      return resetOk
    // Real handler crashes reproduce; smoke timeouts don't.
    case 'runtime-error':
      return !/smoke timeout/i.test(outcome.stderrSnippet ?? '')
    default:
      return false
  }
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
