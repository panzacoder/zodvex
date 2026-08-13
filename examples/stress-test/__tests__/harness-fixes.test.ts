// Regression tests for the harness defects found in PR #81 review:
// 1. deploy() silently targeting an ambient CONVEX_DEPLOYMENT
// 2. default plan/shape composing a shape main's codegen can't produce
// 3. `${name}s` table-name fallback missing irregular plurals ('activitys')
// 4. measureBundle spawning bun (process.execPath), making the V8 heap
//    cap and OOM detection inert
import { mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { spawnSync } from 'child_process'
import { describe, expect, test } from 'vitest'
import { resolveDeploymentSlug } from '../realDeploy.js'
import { extractTableName } from '../compose.js'
import { defaultPlan } from '../regression.js'
import { DEFAULT_SHAPE } from '../sweep.js'

const __dirname = new URL('.', import.meta.url).pathname

describe('resolveDeploymentSlug', () => {
  test('explicit deployment option wins over everything', () => {
    const r = resolveDeploymentSlug({
      explicit: 'dev:explicit-1',
      envSlug: 'dev:ambient-2',
      envFileSlug: 'dev:pinned-3',
    })
    expect(r).toEqual({ slug: 'dev:explicit-1' })
  })

  test('pinned _deploy/.env.local wins over ambient CONVEX_DEPLOYMENT', () => {
    const r = resolveDeploymentSlug({
      envSlug: 'dev:some-other-project',
      envFileSlug: 'dev:pinned-3',
    })
    expect(r).toEqual({ slug: 'dev:pinned-3' })
  })

  test('ambient CONVEX_DEPLOYMENT alone is refused, not deployed to', () => {
    const r = resolveDeploymentSlug({ envSlug: 'dev:some-other-project' })
    expect(r).not.toHaveProperty('slug')
    expect((r as { error: string }).error).toMatch(/_deploy\/\.env\.local/)
    expect((r as { error: string }).error).toMatch(/CONVEX_DEPLOYMENT/)
  })

  test('nothing configured is an error', () => {
    const r = resolveDeploymentSlug({})
    expect(r).not.toHaveProperty('slug')
  })
})

describe('extractTableName', () => {
  test('zodvex seeds: from defineZodModel first argument', () => {
    const model = `export const ActivityModel = defineZodModel('activities', { kind: z.string() })`
    expect(extractTableName('activity', model, '')).toBe('activities')
  })

  test('parity seeds: from db.query() in the endpoint source', () => {
    const model = `export const ActivityTable = defineTable(activityFields)`
    const endpoint = `export const listActivities = query({
  handler: async (ctx) => ctx.db.query('activities').collect(),
})`
    expect(extractTableName('activity', model, endpoint)).toBe('activities')
  })

  test('parity seeds: from db.insert() in the endpoint source', () => {
    const endpoint = `const id = await ctx.db.insert('notifications', { read: false })`
    expect(extractTableName('notification', '', endpoint)).toBe('notifications')
  })

  test('falls back to name+s when nothing matches', () => {
    expect(extractTableName('task', '', '')).toBe('tasks')
  })
})

describe('defaultPlan', () => {
  test('zodvex flavors default to the explicit shape (works against main)', () => {
    for (const target of [100, 600]) {
      const plan = defaultPlan(target)
      for (const flavor of ['zodvex', 'zodvex-mini'] as const) {
        const entry = plan.find(e => e.flavor === flavor)
        expect(entry, `${flavor} in plan(${target})`).toBeDefined()
        expect(entry!.shape).toBe('explicit')
        expect(entry!.lazyTables).toBe(false)
      }
    }
  })

  test('convex-helpers zod4 expectation tracks the target (OOM wall ~N=500)', () => {
    expect(defaultPlan(100).find(e => e.flavor === 'convex-helpers')!.expectedDeploy).toBe('ok')
    expect(defaultPlan(600).find(e => e.flavor === 'convex-helpers')!.expectedDeploy).toBe('oom')
  })
})

describe('sweep defaults', () => {
  test('default shape is the main-compatible explicit shape', () => {
    expect(DEFAULT_SHAPE).toBe('explicit')
  })
})

describe('measureBundle heap cap', () => {
  test('a bundle allocating past the cap is detected as OOM even when the harness runs under bun', () => {
    const dir = join(tmpdir(), `zodvex-stress-oom-${process.pid}`)
    mkdirSync(dir, { recursive: true })

    // ~240 MB of packed-double arrays — far past a 64 MB old-space cap.
    writeFileSync(join(dir, 'hog.mjs'), `const hog = []
for (let i = 0; i < 30; i++) hog.push(new Array(1 << 20).fill(i))
export const total = hog.length
`)
    // Driver reproduces production: the harness itself runs under bun,
    // so process.execPath is bun — the child must still be capped node.
    writeFileSync(join(dir, 'driver.ts'), `import { measureBundle } from '${join(__dirname, '..', 'measureBundle.ts')}'
const r = await measureBundle({ bundle: '${join(dir, 'hog.mjs')}', maxOldSpaceMB: 64, timeoutMs: 30_000 })
console.log(JSON.stringify(r))
`)

    const run = spawnSync('bun', ['run', join(dir, 'driver.ts')], { encoding: 'utf-8', timeout: 60_000 })
    const lastLine = run.stdout.trim().split('\n').pop() ?? ''
    const result = JSON.parse(lastLine)
    expect(result.oom, `expected OOM under a 64 MB cap, got: ${lastLine}`).toBe(true)
    expect(result.ok).toBe(false)
  }, 90_000)
})
