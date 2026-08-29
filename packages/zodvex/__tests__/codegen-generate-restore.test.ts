import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { generate } from '../src/public/cli/commands'

/**
 * #104: a failed generate must not clobber the existing registry. generate()
 * stubs _zodvex/api.js before discovery (to break import cycles with the
 * previous generation); when discovery throws — e.g. the strict
 * import-failure error from #99 — the pre-existing files must be restored.
 */

const tmpDirs: string[] = []

function makeConvexDir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zodvex-generate-restore-'))
  tmpDirs.push(dir)
  const convexDir = path.join(dir, 'convex')
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(convexDir, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content)
  }
  return convexDir
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

const BROKEN_MODULE = `import { missing } from './does-not-exist'\nexport const value = missing\n`

/** Like makeConvexDir but INSIDE the package, so bare 'zodvex/*' imports in
 *  fixture files resolve through the workspace node_modules. */
function makeLocalConvexDir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(__dirname, 'tmp-firstrun-'))
  tmpDirs.push(dir)
  const convexDir = path.join(dir, 'convex')
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(convexDir, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content)
  }
  return convexDir
}

describe('first generate on a fresh checkout (no _zodvex/)', () => {
  it('discovers functions through the bootstrap server.ts stub on run ONE', async () => {
    // init-scaffolded projects gitignore convex/_zodvex/, so CI and fresh
    // clones hit the bootstrap stubs. The stub initZodvex must attach real
    // zodvex meta or run 1 ships empty registries (and --check immediately
    // reports its own output as stale).
    const convexDir = makeLocalConvexDir({
      '_generated/server.ts': `export const query = (fn: any) => fn
export const mutation = (fn: any) => fn
export const action = (fn: any) => fn
export const internalQuery = (fn: any) => fn
export const internalMutation = (fn: any) => fn
export const internalAction = (fn: any) => fn
`,
      'functions.ts': `import { initZodvex } from './_zodvex/server'
import {
  query, mutation, action, internalQuery, internalMutation, internalAction,
} from './_generated/server'
export const { zq, zm, za, ziq, zim, zia } = initZodvex({
  query, mutation, action, internalQuery, internalMutation, internalAction,
})
`,
      'tasks.ts': `import { z } from 'zod'
import { zq } from './functions'
export const list = zq({
  args: {},
  returns: z.number(),
  handler: async () => 1,
})
`
    })

    await generate(convexDir)

    const api = fs.readFileSync(path.join(convexDir, '_zodvex/api.js'), 'utf-8')
    expect(api).toContain("'tasks:list'")
  })
})

describe('generate() failure leaves _zodvex untouched (#104)', () => {
  it('restores the pre-existing api.js/api.d.ts when discovery fails', async () => {
    const convexDir = makeConvexDir({
      'broken.ts': BROKEN_MODULE,
      '_zodvex/api.js': '// checked-in registry — must survive a failed generate\n',
      '_zodvex/api.d.ts': '// checked-in declarations — must survive a failed generate\n'
    })

    await expect(generate(convexDir)).rejects.toThrow(/failed to import/)

    expect(fs.readFileSync(path.join(convexDir, '_zodvex/api.js'), 'utf-8')).toBe(
      '// checked-in registry — must survive a failed generate\n'
    )
    expect(fs.readFileSync(path.join(convexDir, '_zodvex/api.d.ts'), 'utf-8')).toBe(
      '// checked-in declarations — must survive a failed generate\n'
    )
  })

  it('removes the bootstrap stubs when there was no prior registry', async () => {
    const convexDir = makeConvexDir({ 'broken.ts': BROKEN_MODULE })

    await expect(generate(convexDir)).rejects.toThrow(/failed to import/)

    expect(fs.existsSync(path.join(convexDir, '_zodvex/api.js'))).toBe(false)
    expect(fs.existsSync(path.join(convexDir, '_zodvex/api.d.ts'))).toBe(false)
  })

  it('restores models/index.js and api.args.js when discovery fails', async () => {
    // These are statically imported by the real server.ts — an empty stub
    // left behind is valid JS that deploys fine and silently disables all
    // codec decoding (worse than the original #104 registry clobber).
    const convexDir = makeConvexDir({
      'broken.ts': BROKEN_MODULE,
      '_zodvex/models/index.js': '// checked-in tableMap — must survive a failed generate\n',
      '_zodvex/models/index.d.ts': '// checked-in tableMap decls — must survive\n',
      '_zodvex/api.args.js': '// checked-in args registry — must survive a failed generate\n',
      '_zodvex/api.args.d.ts': '// checked-in args decls — must survive\n'
    })

    await expect(generate(convexDir)).rejects.toThrow(/failed to import/)

    expect(fs.readFileSync(path.join(convexDir, '_zodvex/models/index.js'), 'utf-8')).toBe(
      '// checked-in tableMap — must survive a failed generate\n'
    )
    expect(fs.readFileSync(path.join(convexDir, '_zodvex/api.args.js'), 'utf-8')).toBe(
      '// checked-in args registry — must survive a failed generate\n'
    )
  })

  it('removes bootstrap descriptor/args stubs when there was no prior generation', async () => {
    const convexDir = makeConvexDir({ 'broken.ts': BROKEN_MODULE })

    await expect(generate(convexDir)).rejects.toThrow(/failed to import/)

    expect(fs.existsSync(path.join(convexDir, '_zodvex/models/index.js'))).toBe(false)
    expect(fs.existsSync(path.join(convexDir, '_zodvex/api.args.js'))).toBe(false)
  })

  it('still generates normally when discovery succeeds', async () => {
    const convexDir = makeConvexDir({
      '_zodvex/api.js': '// stale registry to be replaced\n'
    })

    await generate(convexDir)

    const api = fs.readFileSync(path.join(convexDir, '_zodvex/api.js'), 'utf-8')
    expect(api).toContain('zodvexRegistry')
    expect(api).not.toContain('must survive')
  })
})
