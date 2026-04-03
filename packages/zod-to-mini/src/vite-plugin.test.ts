import { describe, it, expect } from 'vitest'
import { zodToMiniPlugin } from './vite-plugin'

describe('zodToMiniPlugin', () => {
  it('returns a vite plugin with correct name', () => {
    const plugin = zodToMiniPlugin()
    expect(plugin.name).toBe('zod-to-mini')
    expect(plugin.enforce).toBe('pre')
  })

  it('transforms .ts files with zod method chains', () => {
    const plugin = zodToMiniPlugin()
    const transform = plugin.transform as (code: string, id: string) => { code: string; map: null } | undefined

    const input = `import { z } from 'zod'\nconst s = z.string().optional()`
    const result = transform.call({}, input, '/test/file.ts')

    expect(result).not.toBeUndefined()
    expect(result!.code).toContain('z.optional(z.string())')
  })

  it('skips non-ts/js files', () => {
    const plugin = zodToMiniPlugin()
    const transform = plugin.transform as (code: string, id: string) => { code: string; map: null } | undefined

    const result = transform.call({}, 'const x = 1', '/test/file.css')
    expect(result).toBeUndefined()
  })

  it('skips files without zod references', () => {
    const plugin = zodToMiniPlugin()
    const transform = plugin.transform as (code: string, id: string) => { code: string; map: null } | undefined

    const result = transform.call({}, 'const x = 1', '/test/file.ts')
    expect(result).toBeUndefined()
  })

  it('skips files where no transforms apply', () => {
    const plugin = zodToMiniPlugin()
    const transform = plugin.transform as (code: string, id: string) => { code: string; map: null } | undefined

    // File imports zod but uses no method chains
    const input = `import { z } from 'zod'\nconst s = z.string()`
    const result = transform.call({}, input, '/test/file.ts')
    expect(result).toBeUndefined()
  })

  it('respects include option', () => {
    const plugin = zodToMiniPlugin({ include: /__tests__/ })
    const transform = plugin.transform as (code: string, id: string) => { code: string; map: null } | undefined

    const input = `import { z } from 'zod'\nconst s = z.string().optional()`

    const included = transform.call({}, input, '/project/__tests__/file.ts')
    expect(included).not.toBeUndefined()

    const excluded = transform.call({}, input, '/project/src/file.ts')
    expect(excluded).toBeUndefined()
  })

  it('respects exclude option', () => {
    const plugin = zodToMiniPlugin({ exclude: /node_modules/ })
    const transform = plugin.transform as (code: string, id: string) => { code: string; map: null } | undefined

    const input = `import { z } from 'zod'\nconst s = z.string().optional()`

    const excluded = transform.call({}, input, '/project/node_modules/zod/index.ts')
    expect(excluded).toBeUndefined()

    const included = transform.call({}, input, '/project/src/file.ts')
    expect(included).not.toBeUndefined()
  })

  it('accepts tsconfig option', () => {
    const plugin = zodToMiniPlugin({ tsconfig: '/fake/tsconfig.json' })
    expect(plugin.name).toBe('zod-to-mini')
  })
})
