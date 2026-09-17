import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { z } from 'zod'
import { generateApiFile } from 'zodvex/codegen'
import { composeCapacity, lazyRegistryHelper, registryEntry, variants } from './compose.js'

/** The generator's runtime form of the fixture helper: type annotations removed. */
const runtimeHelper = lazyRegistryHelper
  .replace('<string, unknown>', '')
  .replace('<T,>', '')
  .replace(': string, build: () => T): T', ', build)')
  .replace(' as T | undefined', '')

describe('capacity registry fixtures', () => {
  const generated = generateApiFile([{
    functionPath: 'unused/fn0', exportName: 'fn0', sourceFile: 'unused.ts',
    zodArgs: z.object({ id: z.string() }), zodReturns: z.string(),
  }], []).js

  test('lazy fixture helper is the memoizing helper zodvex generate emits', () => {
    const start = generated.indexOf('const __memo')
    const end = generated.indexOf('export const zodvexRegistry')
    expect(start).toBeGreaterThan(-1)
    expect(generated.slice(start, end).trim()).toBe(runtimeHelper.trim())
  })

  test('lazy fixture entries have the getter shape zodvex generate emits', () => {
    const match = generated.match(/  get 'unused\/fn0'\(\) \{\n[\s\S]*?\n  \}/)
    expect(match).not.toBeNull()
    const emitted = match![0].replace(/args: .*,\n/, 'args: <A>,\n').replace(/returns: .*,\n/, 'returns: <R>,\n')
    expect(registryEntry('unused/fn0', '<A>', '<R>', 'lazy')).toBe(emitted)
  })

  test('composed app carries eager and lazy registry variants with 128 entries each', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zodvex-capacity-'))
    try {
      const fixture = composeCapacity(dir)
      for (const kind of ['full', 'mini']) {
        const eager = readFileSync(join(dir, `${kind}_registry/registry.ts`), 'utf8')
        const lazy = readFileSync(join(dir, `${kind}_registry_lazy/registry.ts`), 'utf8')
        expect(eager.match(/^  'unused\/fn\d+': \{/gm)).toHaveLength(128)
        expect(eager).not.toContain('__lazy')
        expect(lazy).toContain(lazyRegistryHelper)
        expect(lazy.match(/^  get 'unused\/fn\d+'\(\) \{$/gm)).toHaveLength(128)
        expect(lazy.match(/__lazy\('unused\/fn\d+', \(\) => \(\{/g)).toHaveLength(128)
        expect(lazy).not.toMatch(/^  'unused\/fn\d+': \{/m)
        expect(readFileSync(join(dir, `${kind}_registry_lazy/query.ts`), 'utf8')).toContain("registry: () => registry")
      }
      expect(fixture.variants.map(v => v.name)).toEqual(variants.map(v => v.name))
      expect(variants.filter(v => v.registry === 'lazy').map(v => v.name)).toEqual(['full_registry_lazy', 'mini_registry_lazy'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
