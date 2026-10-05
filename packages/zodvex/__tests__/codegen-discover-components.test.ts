import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { discoverModules } from '../src/public/codegen/discover'

const componentFixtureDir = path.resolve(__dirname, 'fixtures/codegen-components')

describe('discoverModules with component imports', () => {
  it('discovers functions from files that import _generated/api at module scope', async () => {
    const result = await discoverModules(componentFixtureDir)

    const fnPaths = result.functions.map(f => f.functionPath)
    expect(fnPaths).toContain('visits:dropIn')
  })

  it('does not warn about _generated/api import failures when stubs are active', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      await discoverModules(componentFixtureDir)
    } finally {
      warnSpy.mockRestore()
    }

    const apiWarnings = warnSpy.mock.calls.filter(args => args.join(' ').includes('_generated'))
    expect(apiWarnings).toEqual([])
  })

  it('restores _generated/api.ts after discovery completes', async () => {
    const fs = await import('node:fs')
    const apiPath = path.join(componentFixtureDir, '_generated/api.ts')
    const originalContent = fs.readFileSync(apiPath, 'utf8')

    await discoverModules(componentFixtureDir)

    const restoredContent = fs.readFileSync(apiPath, 'utf8')
    expect(restoredContent).toBe(originalContent)
  })
})
