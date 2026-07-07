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
