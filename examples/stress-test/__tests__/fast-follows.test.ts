// Regression tests for the fast-follow defects from the PR #81 review:
// transient outcomes cached as permanent, divergent/over-broad failure
// classifiers, bench stats skew + zero-work pool hang, and the fingerprint
// deployment slug diverging from what deploy() actually targets.
import { existsSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, test } from 'vitest'
import { bench, bundleBytesStats } from '../bench.js'
import { applyFlavorImportRewrites, compose } from '../compose.js'
import { collectMeta, fingerprintCell, isCacheableOutcome } from '../harnessMeta.js'
import { classify, pinnedDeploymentSlug } from '../realDeploy.js'

describe('isCacheableOutcome', () => {
  test('diff-independent outcomes are cacheable even without a clean reset', () => {
    // Analysis-isolate and count-based limits don't depend on the push diff.
    for (const kind of ['oom', 'function-limit', 'bundle-limit', 'schema-error'] as const) {
      expect(isCacheableOutcome({ kind }, false), kind).toBe(true)
    }
  })

  test('transient outcomes are never cached', () => {
    expect(isCacheableOutcome({ kind: 'timeout' }, true)).toBe(false)
    // 'other' includes unclassified network flakes.
    expect(isCacheableOutcome({ kind: 'other' }, true)).toBe(false)
  })

  test('diff-dependent outcomes (ok, too-many-reads) require a clean reset', () => {
    // Residual state from a failed reset can shrink the diff (false pass)
    // or stack it (spurious TooManyReads) — either way the cell is
    // contaminated as a fresh-diff claim.
    for (const kind of ['ok', 'too-many-reads'] as const) {
      expect(isCacheableOutcome({ kind }, true), kind).toBe(true)
      expect(isCacheableOutcome({ kind }, false), kind).toBe(false)
    }
  })

  test('runtime-error from a smoke timeout is transient; a real handler crash is not', () => {
    expect(
      isCacheableOutcome(
        { kind: 'runtime-error', stderrSnippet: '[smoke endpoints/healthcheck:healthcheck] smoke timeout after 30000ms' },
        true,
      ),
    ).toBe(false)
    expect(
      isCacheableOutcome(
        { kind: 'runtime-error', stderrSnippet: 'Uncaught Error: dynamic module import unsupported' },
        true,
      ),
    ).toBe(true)
  })
})

describe('classify', () => {
  test('esbuild errors that merely mention schema.ts are not schema-errors', () => {
    const stderr = `✘ [ERROR] Could not resolve "zodvex"\n\n    convex/schema.ts:1:20\n\n✖ Error: bundler failed`
    expect(classify('', stderr)).toBe('other')
  })

  test("Convex's real schema-evaluation failure is a schema-error", () => {
    const stderr = `✖ Error fetching POST https://x.convex.cloud/api/deploy2/start_push 400 : Error: Hit an error while pushing:\nHit an error while evaluating your schema:\nUncaught TypeError: undefined is not a function`
    expect(classify('', stderr)).toBe('schema-error')
  })

  test('schema validation failures are schema-errors', () => {
    expect(classify('', 'Schema validation failed: document does not match')).toBe('schema-error')
  })

  test('OOM during schema evaluation stays classified as oom', () => {
    const stderr = `Hit an error while evaluating your schema:\nJavaScript execution ran out of memory (maximum memory usage: 64 MB)`
    expect(classify('', stderr)).toBe('oom')
  })

  test("the backend's actual function-file limit message is a function-limit", () => {
    expect(classify('', 'Error: Too many function files (8193 > 8192)')).toBe('function-limit')
  })

  test('TooManyReads during finish_push is too-many-reads', () => {
    const stderr = `finish_push 400 Bad Request: TooManyReads: Hit an error while pushing:\nToo many reads in a single function execution (limit: 4096).`
    expect(classify('', stderr)).toBe('too-many-reads')
  })
})

describe('bench guards and stats', () => {
  test('bundle-byte stats exclude endpoints whose bundling failed', () => {
    const metrics = [
      { bundled: true, bundleBytes: 1000 },
      { bundled: true, bundleBytes: 3000 },
      { bundled: false, bundleBytes: 0 },
    ]
    const s = bundleBytesStats(metrics as any)
    expect(s.min).toBe(1000)
    expect(s.max).toBe(3000)
    expect(s.sum).toBe(4000)
  })

  test('bench rejects a zero/negative endpoint count instead of hanging', async () => {
    await expect(bench({ flavor: 'convex', count: 0, verbose: false })).rejects.toThrow(/count/)
  })

  test('bench rejects a non-positive sample instead of silently mismeasuring', async () => {
    await expect(bench({ flavor: 'convex', count: 1, sample: -1, verbose: false })).rejects.toThrow(/sample/)
    await expect(bench({ flavor: 'convex', count: 1, sample: 0, verbose: false })).rejects.toThrow(/sample/)
  })
})

describe('convex-helpers-zod3 seed derivation', () => {
  test('rewrites zod and convex-helpers imports for the zod3 flavor', () => {
    const src = `import { z } from 'zod'\nimport { zid, zodToConvexFields } from 'convex-helpers/server/zod4'\nexport const x = z.string()`
    const out = applyFlavorImportRewrites('convex-helpers-zod3', src, 'task.ts')
    expect(out).toContain("from 'zod/v3'")
    expect(out).toContain("from 'convex-helpers/server/zod3'")
    expect(out).not.toContain("from 'zod'\n")
    expect(out).not.toContain('zod4')
  })

  test('leaves the convex-helpers (zod4) flavor untouched', () => {
    const src = `import { z } from 'zod'\nimport { zid } from 'convex-helpers/server/zod4'`
    expect(applyFlavorImportRewrites('convex-helpers', src, 'task.ts')).toBe(src)
  })

  test('composed zod3 trees derive from the convex-helpers corpus with rewritten imports', () => {
    const outputDir = join(tmpdir(), `zodvex-stress-zod3-${process.pid}`)
    try {
      compose({ flavor: 'convex-helpers-zod3', count: 1, outputDir })
      const model = readFileSync(join(outputDir, 'models', 'activity_0000.ts'), 'utf-8')
      expect(model).toContain("from 'zod/v3'")
      expect(model).toContain("from 'convex-helpers/server/zod3'")
      const endpoint = readFileSync(join(outputDir, 'endpoints', 'activity_0000.ts'), 'utf-8')
      expect(endpoint).toContain("from 'zod/v3'")
      // Per-copy table rename must still hold on the derived corpus.
      expect(endpoint).toContain("'activities_0000'")
    } finally {
      if (existsSync(outputDir)) rmSync(outputDir, { recursive: true })
    }
  })
})

describe('fingerprintCell', () => {
  test('is deterministic across repeated calls (memoized subtree digests)', () => {
    const meta = collectMeta()
    const key = { flavor: 'zodvex', shape: 'explicit', n: 5, models: 5 }
    const a = fingerprintCell(key, meta)
    const b = fingerprintCell(key, meta)
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  test('distinct cell keys produce distinct fingerprints', () => {
    const meta = collectMeta()
    const a = fingerprintCell({ flavor: 'zodvex', shape: 'explicit', n: 5, models: 5 }, meta)
    const b = fingerprintCell({ flavor: 'zodvex', shape: 'explicit', n: 6, models: 6 }, meta)
    expect(a).not.toBe(b)
  })
})

describe('fingerprint deployment slug', () => {
  const saved = process.env.CONVEX_DEPLOYMENT
  afterEach(() => {
    if (saved === undefined) delete process.env.CONVEX_DEPLOYMENT
    else process.env.CONVEX_DEPLOYMENT = saved
  })

  test('collectMeta uses the pinned deployment, never ambient CONVEX_DEPLOYMENT', () => {
    process.env.CONVEX_DEPLOYMENT = 'dev:fake-ambient-project'
    const meta = collectMeta()
    expect(meta.deployment).not.toBe('dev:fake-ambient-project')
    expect(meta.deployment).toBe(pinnedDeploymentSlug())
  })
})
