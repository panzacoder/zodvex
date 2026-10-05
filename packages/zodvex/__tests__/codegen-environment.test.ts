import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as globby from 'tinyglobby'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generate } from '../src/public/cli/commands'
import { discoverModules } from '../src/public/codegen/discover'

vi.mock('tinyglobby', { spy: true })

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zodvex-environment-'))
const convex = path.join(root, 'convex')
const names = [
  'schema.js',
  'schema.d.ts',
  'api.js',
  'api.d.ts',
  'client.js',
  'client.d.ts',
  'server.js',
  'server.d.ts'
]
const originals = new Map(names.map(name => [name, Buffer.from(`original:${name}\r\n`)]))

function write(relative: string, bytes: string | Buffer) {
  const file = path.join(convex, relative)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, bytes)
}
function seed() {
  for (const [name, bytes] of originals) write(`_zodvex/${name}`, bytes)
  write('_generated/api.ts', Buffer.from([0xff, 0xfe, 0x00, 0x0d, 0x0a]))
}
function expectRestored() {
  for (const [name, bytes] of originals)
    expect(fs.readFileSync(path.join(convex, '_zodvex', name))).toEqual(bytes)
  expect(fs.readFileSync(path.join(convex, '_generated/api.ts'))).toEqual(
    Buffer.from([0xff, 0xfe, 0x00, 0x0d, 0x0a])
  )
}
beforeEach(() => {
  fs.rmSync(convex, { recursive: true, force: true })
  fs.mkdirSync(convex)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})
afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('discovery environment through public operations', () => {
  it('restores original bytes after successful discovery', async () => {
    seed()
    await discoverModules(convex)
    expectRestored()
  })

  it('removes only an operation-created empty generated directory', async () => {
    await discoverModules(convex)
    expect(fs.existsSync(path.join(convex, '_generated'))).toBe(false)
    write('_generated/keep.txt', 'retain')
    await discoverModules(convex)
    expect(fs.readFileSync(path.join(convex, '_generated/keep.txt'), 'utf8')).toBe('retain')
    expect(fs.existsSync(path.join(convex, '_generated/api.ts'))).toBe(false)
  })

  it('restores after a partial bootstrap write fails', async () => {
    seed()
    const actual = fs.writeFileSync
    let failed = false
    vi.spyOn(fs, 'writeFileSync').mockImplementation((file, ...args) => {
      if (!failed && String(file).endsWith('_zodvex/api.d.ts')) {
        failed = true
        actual(file, 'partial')
        throw new Error('bootstrap failed')
      }
      return actual(file, ...args)
    })
    await expect(generate(convex)).rejects.toThrow('bootstrap failed')
    expectRestored()
  })

  it('restores a partially written discovery stub', async () => {
    seed()
    const actual = fs.writeFileSync
    let failed = false
    vi.spyOn(fs, 'writeFileSync').mockImplementation((file, ...args) => {
      if (!failed && String(file).endsWith('_generated/api.ts')) {
        failed = true
        actual(file, 'partial')
        throw new Error('stub failed')
      }
      return actual(file, ...args)
    })
    await expect(discoverModules(convex)).rejects.toThrow('stub failed')
    expectRestored()
  })

  it('restores after strict imports fail and preserves the permissive escape hatch', async () => {
    seed()
    write('strict-failure.js', 'throw new Error("broken module")')
    await expect(generate(convex)).rejects.toThrow('failed to import')
    expectRestored()
    vi.stubEnv('ZODVEX_ALLOW_IMPORT_FAILURES', '1')
    await generate(convex)
    expect(fs.readFileSync(path.join(convex, '_zodvex/api.js'), 'utf8')).toContain('zodvexRegistry')
    expect(fs.readFileSync(path.join(convex, '_generated/api.ts'))).toEqual(
      Buffer.from([0xff, 0xfe, 0x00, 0x0d, 0x0a])
    )
  })

  it('retains a directory created during discovery if an imported module adds a file', async () => {
    write(
      'keep-directory.js',
      `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(path.join(convex, '_generated/keep.txt'))}, 'keep')`
    )
    await discoverModules(convex)
    expect(fs.readFileSync(path.join(convex, '_generated/keep.txt'), 'utf8')).toBe('keep')
    expect(fs.existsSync(path.join(convex, '_generated/api.ts'))).toBe(false)
  })

  it('restores originals when schema generation rejects an unimportable codec', async () => {
    seed()
    write(
      'unimportable-codec.js',
      `
import { z } from ${JSON.stringify(path.resolve(__dirname, '../node_modules/zod/index.js'))};
const codec = z.codec(z.string(), z.string(), { decode: value => value, encode: value => value });
export const handler = () => null;
Object.defineProperty(handler, '__zodvexMeta', { value: { type: 'function', zodArgs: z.object({ value: codec }) } });
`
    )
    await expect(generate(convex)).rejects.toThrow('no importable reference')
    expectRestored()
  })

  it('restores after enumeration fails', async () => {
    seed()
    vi.mocked(globby.globSync).mockImplementationOnce(() => {
      throw new Error('enumeration failed')
    })
    await expect(discoverModules(convex)).rejects.toThrow('enumeration failed')
    expectRestored()
  })

  it.each(names)('rolls back the complete output when writing %s fails', async name => {
    seed()
    const actual = fs.writeFileSync
    let failed = false
    vi.spyOn(fs, 'writeFileSync').mockImplementation((file, data, ...args) => {
      if (
        !failed &&
        String(file).endsWith(`_zodvex/${name}`) &&
        !String(data).includes('Stub created for codegen bootstrap')
      ) {
        failed = true
        actual(file, 'partial')
        throw new Error('output failed')
      }
      return actual(file, data, ...args)
    })
    await expect(generate(convex)).rejects.toThrow('output failed')
    expectRestored()
  })

  it('restores previous absence after an output failure', async () => {
    const actual = fs.writeFileSync
    vi.spyOn(fs, 'writeFileSync').mockImplementation((file, ...args) => {
      if (String(file).endsWith('_zodvex/server.d.ts')) throw new Error('output failed')
      return actual(file, ...args)
    })
    await expect(generate(convex)).rejects.toThrow('output failed')
    expect(fs.readdirSync(convex)).toEqual([])
  })

  it('reports cleanup failures while restoring the remaining files', async () => {
    seed()
    const actual = fs.writeFileSync
    const failure = new Error('output failed')
    let failed = false
    vi.spyOn(fs, 'writeFileSync').mockImplementation((file, data, ...args) => {
      if (!failed && String(file).endsWith('_zodvex/server.js')) {
        failed = true
        throw failure
      }
      if (
        String(file).endsWith('_zodvex/api.js') &&
        Buffer.from(data as string).equals(originals.get('api.js') as Buffer)
      )
        throw new Error('restore failed')
      return actual(file, data, ...args)
    })
    const error = await generate(convex).catch(error => error)
    expect(error).toBeInstanceOf(AggregateError)
    expect(error.cause).toBe(failure)
    expect(error.errors).toHaveLength(2)
    expect(error.message).toContain('output failed')
    expect(error.message).toContain('restore failed')
    expect(fs.readFileSync(path.join(convex, '_zodvex/api.d.ts'))).toEqual(
      originals.get('api.d.ts')
    )
    expect(fs.readFileSync(path.join(convex, '_zodvex/schema.js'))).toEqual(
      originals.get('schema.js')
    )
  })

  it('rejects successful discovery when restoring its stub fails', async () => {
    const actual = fs.unlinkSync
    vi.spyOn(fs, 'unlinkSync').mockImplementation(file => {
      if (String(file).endsWith('_generated/api.ts')) throw new Error('cleanup failed')
      return actual(file)
    })
    await expect(discoverModules(convex)).rejects.toThrow('Discovery restoration failed')
  })

  it('refuses unreadable snapshots before replacing any file', async () => {
    seed()
    const actual = fs.readFileSync
    vi.spyOn(fs, 'readFileSync').mockImplementation((file, ...args) => {
      if (String(file).endsWith('_zodvex/api.d.ts'))
        throw Object.assign(new Error('unreadable'), { code: 'EACCES' })
      return actual(file, ...args)
    })
    await expect(generate(convex)).rejects.toThrow('unreadable')
    vi.restoreAllMocks()
    expectRestored()
  })

  it('rejects a different project before bootstrap changes', async () => {
    await discoverModules(convex)
    const other = path.join(root, 'other')
    fs.mkdirSync(other)
    await expect(generate(other)).rejects.toThrow('fresh process')
    expect(fs.readdirSync(other)).toEqual([])
  })
})
