import { spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { regenerate } from '../src/public/cli/commands'

// Heath's `zodvex dev` bug: under Bun, the long-lived watcher re-imported edited
// modules in-process, but Bun caches ESM by resolved path and ignores the
// query-string cache-busting that worked under Node — so `_zodvex/api.js` never
// reflected edits. The prior regression test only ran under Node/Vitest (where
// query-busting works), so it stayed green while real `bun run dev` was broken.
//
// The fix: the watcher spawns a fresh `generate` subprocess per change. A new
// process has an empty module cache on every runtime, so it always sees the
// latest source. These tests pin both halves of that: (1) the watcher spawns a
// subprocess rather than regenerating in-process, and (2) a fresh `generate`
// under the REAL runtime reflects edits between runs.

// Mock only `spawn` (keep the real spawnSync for the integration test below).
const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }))
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, spawn: spawnMock }
})

describe('regenerate: watch-mode runs in a fresh subprocess', () => {
  beforeEach(() => spawnMock.mockReset())

  it('spawns a one-shot `generate` subprocess instead of regenerating in-process', async () => {
    const child = new EventEmitter() as EventEmitter & { stdout?: unknown }
    spawnMock.mockReturnValue(child)

    const done = regenerate('/abs/convex', { mini: true })
    child.emit('exit', 0)
    await done

    expect(spawnMock).toHaveBeenCalledTimes(1)
    const [bin, args, opts] = spawnMock.mock.calls[0]
    // Spawned with the same runtime that's running the watcher (Bun or Node) —
    // so the regen process matches the dev process.
    expect(bin).toBe(process.execPath)
    expect(String(args[0])).toMatch(/cli[\\/]index\.js$/)
    expect(args.slice(1)).toEqual(['generate', '/abs/convex', '--mini'])
    expect(opts).toEqual({ stdio: 'inherit' })
  })

  it('omits --mini when not requested', async () => {
    const child = new EventEmitter()
    spawnMock.mockReturnValue(child)

    const done = regenerate('/abs/convex')
    child.emit('exit', 0)
    await done

    const [, args] = spawnMock.mock.calls[0]
    expect(args.slice(1)).toEqual(['generate', '/abs/convex'])
  })
})

describe('zodvex generate reflects edits across runs (real runtime)', () => {
  const bunAvailable = (() => {
    try {
      return spawnSync('bun', ['--version']).status === 0
    } catch {
      return false
    }
  })()

  let tmpRoot: string
  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'zodvex-watch-bun-'))
  })
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  // Plain .js fixture with zodvex meta attached directly — no package-relative
  // imports needed from the tmp dir.
  const moduleSource = (label: string) => `
const handler = () => '${label}'
Object.defineProperty(handler, '__zodvexMeta', {
  value: { type: 'function' },
  enumerable: false
})
export const ${label} = handler
`

  it.skipIf(!bunAvailable)(
    'two successive `bun generate` runs each reflect the latest source (would catch the Bun staleness bug)',
    () => {
      const cli = fileURLToPath(new URL('../src/public/cli/index.ts', import.meta.url))
      const jobs = path.join(tmpRoot, 'jobs.js')

      writeFileSync(jobs, moduleSource('alpha'))
      const r1 = spawnSync('bun', [cli, 'generate', tmpRoot], { encoding: 'utf-8' })
      if (r1.status !== 0) console.error(r1.stdout, r1.stderr)
      expect(r1.status).toBe(0)
      const api1 = readFileSync(path.join(tmpRoot, '_zodvex', 'api.js'), 'utf-8')
      expect(api1).toContain('jobs:alpha')

      writeFileSync(jobs, moduleSource('bravo'))
      const r2 = spawnSync('bun', [cli, 'generate', tmpRoot], { encoding: 'utf-8' })
      if (r2.status !== 0) console.error(r2.stdout, r2.stderr)
      expect(r2.status).toBe(0)
      const api2 = readFileSync(path.join(tmpRoot, '_zodvex', 'api.js'), 'utf-8')
      expect(api2).toContain('jobs:bravo')
      expect(api2).not.toContain('jobs:alpha')
    }
  )
})
