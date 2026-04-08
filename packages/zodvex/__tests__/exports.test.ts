import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function assertNoServerRuntimeImports(
  entryPath: '../src/index.ts' | '../src/core/index.ts',
  label: string
) {
  const entrySource = await readFile(new URL(entryPath, import.meta.url), 'utf-8')

  // Extract all re-export source paths, tracking which are type-only
  const typeOnlyPaths = new Set<string>()
  const runtimePaths = new Set<string>()

  for (const line of entrySource.split('\n')) {
    const trimmed = line.trim()
    const match = trimmed.match(/from ['"]([^'"]+)['"]/)
    if (!match) continue
    const importPath = match[1]
    if (!importPath.startsWith('../') && !importPath.startsWith('./')) continue

    if (trimmed.startsWith('export type ') || trimmed.startsWith('import type ')) {
      typeOnlyPaths.add(importPath)
    } else {
      runtimePaths.add(importPath)
    }
  }

  // Only check files with runtime (non-type-only) references
  const pathsToCheck = [...runtimePaths]

  // Resolve to actual file paths relative to this test file
  const baseDir = new URL('../src/', import.meta.url).pathname
  const entryDir = entryPath === '../src/index.ts' ? `${baseDir}` : `${baseDir}core/`
  const filesToCheck = pathsToCheck.map(p => {
    const resolved = p.startsWith('../') ? `${baseDir}${p.slice(3)}` : `${entryDir}${p}`
    return resolved.endsWith('.ts') ? resolved : resolved + '.ts'
  })

  for (const filePath of filesToCheck) {
    let content: string
    try {
      content = await readFile(filePath, 'utf-8')
    } catch {
      try {
        content = await readFile(filePath.replace('.ts', '/index.ts'), 'utf-8')
      } catch {
        continue
      }
    }

    const lines = content.split('\n')
    let inTypeImport = false
    for (const line of lines) {
      const trimmed = line.trim()
      // Track multi-line `import type { ... } from '...'` blocks
      if (trimmed.startsWith('import type ')) {
        if (!trimmed.includes('from ')) {
          // Multi-line import type — skip until closing `from` line
          inTypeImport = true
        }
        continue
      }
      if (inTypeImport) {
        if (trimmed.includes('from ')) inTypeImport = false
        continue
      }
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue

      if (trimmed.includes("from 'convex/server'") || trimmed.includes('from "convex/server"')) {
        throw new Error(
          `Runtime import from 'convex/server' found in ${filePath}:\n  ${trimmed}\n` +
            `${label} must be client-safe. Use 'import type' or move to zodvex/server.`
        )
      }
      if (
        trimmed.includes("from 'convex-helpers/server") ||
        trimmed.includes('from "convex-helpers/server')
      ) {
        throw new Error(
          `Runtime import from 'convex-helpers/server' found in ${filePath}:\n  ${trimmed}\n` +
            `${label} must be client-safe. Use 'import type' or move to zodvex/server.`
        )
      }
    }
  }
}

function expectLegacyStub(fn: unknown, name: string) {
  expect(typeof fn).toBe('function')
  expect(() => (fn as () => never)()).toThrowError(
    new RegExp(`\\[zodvex\\].*${name}.*zodvex/legacy`, 's')
  )
}

describe('client-safe full entrypoints have no server runtime imports', () => {
  it('zodvex root is client-safe', async () => {
    await assertNoServerRuntimeImports('../src/index.ts', 'zodvex')
  })

  it('zodvex/core compat alias is client-safe', async () => {
    await assertNoServerRuntimeImports('../src/core/index.ts', 'zodvex/core')
  })
})

describe('zodvex root exports', () => {
  it('exports zx namespace', async () => {
    const { zx } = await import('../src')
    expect(zx).toBeDefined()
    expect(zx.id).toBeDefined()
    expect(zx.date).toBeDefined()
  })

  it('exports zodToConvex', async () => {
    const { zodToConvex } = await import('../src')
    expect(zodToConvex).toBeDefined()
  })

  it('exports zodToConvexFields', async () => {
    const { zodToConvexFields } = await import('../src')
    expect(zodToConvexFields).toBeDefined()
  })

  it('exports createBoundaryHelpers', async () => {
    const { createBoundaryHelpers } = await import('../src')
    expect(createBoundaryHelpers).toBeDefined()
  })

  it('exports codec utilities', async () => {
    const { convexCodec, decodeDoc, encodeDoc, encodePartialDoc } = await import('../src')
    expect(convexCodec).toBeDefined()
    expect(decodeDoc).toBeDefined()
    expect(encodeDoc).toBeDefined()
    expect(encodePartialDoc).toBeDefined()
  })

  it('exports utility functions', async () => {
    const { safePick, safeOmit, zPaginated, stripUndefined } = await import('../src')
    expect(safePick).toBeDefined()
    expect(safeOmit).toBeDefined()
    expect(zPaginated).toBeDefined()
    expect(stripUndefined).toBeDefined()
  })

  it('exports JSON schema utilities', async () => {
    const { zodvexJSONSchemaOverride, toJSONSchema } = await import('../src')
    expect(zodvexJSONSchemaOverride).toBeDefined()
    expect(toJSONSchema).toBeDefined()
  })

  it('exports deprecated legacy root stubs', async () => {
    const root = await import('../src')
    expectLegacyStub((root as any).zodTable, 'zodTable')
    expectLegacyStub((root as any).zodDoc, 'zodDoc')
    expectLegacyStub((root as any).zodDocOrNull, 'zodDocOrNull')
    expectLegacyStub((root as any).zQueryBuilder, 'zQueryBuilder')
    expectLegacyStub((root as any).zMutationBuilder, 'zMutationBuilder')
    expectLegacyStub((root as any).zActionBuilder, 'zActionBuilder')
    expectLegacyStub((root as any).zCustomQueryBuilder, 'zCustomQueryBuilder')
    expectLegacyStub((root as any).zCustomMutationBuilder, 'zCustomMutationBuilder')
    expectLegacyStub((root as any).zCustomActionBuilder, 'zCustomActionBuilder')
  })

  it('does NOT export customCtx', async () => {
    const root = await import('../src')
    expect((root as any).customCtx).toBeUndefined()
  })

  it('does NOT export zCustomQuery', async () => {
    const root = await import('../src')
    expect((root as any).zCustomQuery).toBeUndefined()
  })

  it('does NOT export internal meta utilities', async () => {
    const root = await import('../src')
    expect((root as any).attachMeta).toBeUndefined()
    expect((root as any).readMeta).toBeUndefined()
  })

  it('does NOT export internal mapping helpers', async () => {
    const root = await import('../src')
    expect((root as any).makeUnion).toBeUndefined()
  })

  it('does NOT export internal utils', async () => {
    const root = await import('../src')
    expect((root as any).pick).toBeUndefined()
    expect((root as any).formatZodIssues).toBeUndefined()
    expect((root as any).handleZodValidationError).toBeUndefined()
    expect((root as any).validateReturns).toBeUndefined()
    expect((root as any).assertNoNativeZodDate).toBeUndefined()
  })

  it('does NOT export internal id helpers', async () => {
    const root = await import('../src')
    expect((root as any).registryHelpers).toBeUndefined()
  })
})

describe('zodvex/core compatibility alias', () => {
  it('matches the canonical public client-safe surface', async () => {
    const publicSurface = await import('../src/public')
    const core = await import('../src/core')
    expect(Object.keys(core).sort()).toEqual(Object.keys(publicSurface).sort())
  })

  it('does NOT export deprecated legacy root stubs', async () => {
    const core = await import('../src/core')
    expect((core as any).zodTable).toBeUndefined()
    expect((core as any).zodDoc).toBeUndefined()
    expect((core as any).zodDocOrNull).toBeUndefined()
    expect((core as any).zQueryBuilder).toBeUndefined()
    expect((core as any).zMutationBuilder).toBeUndefined()
    expect((core as any).zActionBuilder).toBeUndefined()
    expect((core as any).zCustomQueryBuilder).toBeUndefined()
    expect((core as any).zCustomMutationBuilder).toBeUndefined()
    expect((core as any).zCustomActionBuilder).toBeUndefined()
  })
})

describe('zodvex/server exports', () => {
  it('exports zodTable', async () => {
    const { zodTable } = await import('../src/server')
    expect(zodTable).toBeDefined()
  })

  it('exports customCtx', async () => {
    const { customCtx } = await import('../src/server')
    expect(customCtx).toBeDefined()
  })

  it('exports function builders', async () => {
    const { zQueryBuilder, zMutationBuilder, zActionBuilder } = await import('../src/server')
    expect(zQueryBuilder).toBeDefined()
    expect(zMutationBuilder).toBeDefined()
    expect(zActionBuilder).toBeDefined()
  })

  it('exports custom function utilities', async () => {
    const { zCustomQuery, zCustomMutation, zCustomAction } = await import('../src/server')
    expect(zCustomQuery).toBeDefined()
    expect(zCustomMutation).toBeDefined()
    expect(zCustomAction).toBeDefined()
  })

  it('exports defineZodSchema', async () => {
    const { defineZodSchema } = await import('../src/server')
    expect(defineZodSchema).toBeDefined()
  })

  it('exports initZodvex', async () => {
    const { initZodvex } = await import('../src/server')
    expect(initZodvex).toBeDefined()
  })

  it('exports createZodvexCustomization', async () => {
    const { createZodvexCustomization } = await import('../src/server')
    expect(createZodvexCustomization).toBeDefined()
  })

  it('exports DB wrapper classes and factories', async () => {
    const {
      ZodvexDatabaseReader,
      ZodvexDatabaseWriter,
      ZodvexQueryChain,
      createZodDbReader,
      createZodDbWriter
    } = await import('../src/server')
    expect(ZodvexDatabaseReader).toBeDefined()
    expect(ZodvexDatabaseWriter).toBeDefined()
    expect(ZodvexQueryChain).toBeDefined()
    expect(createZodDbReader).toBeDefined()
    expect(createZodDbWriter).toBeDefined()
  })

  it('does NOT export internal custom helpers', async () => {
    const server = await import('../src/server')
    expect((server as any).customFnBuilder).toBeUndefined()
  })

  it('does NOT export internal table helpers', async () => {
    const server = await import('../src/server')
    expect((server as any).isZodUnion).toBeUndefined()
    expect((server as any).getUnionOptions).toBeUndefined()
    expect((server as any).assertUnionOptions).toBeUndefined()
    expect((server as any).createUnionFromOptions).toBeUndefined()
  })

  it('does NOT export internal init helpers', async () => {
    const server = await import('../src/server')
    expect((server as any).composeCustomizations).toBeUndefined()
    expect((server as any).createZodvexBuilder).toBeUndefined()
  })
})

describe('zodvex (root) exports', () => {
  it('exports the client-safe full-Zod surface only', async () => {
    const zodvex = await import('../src')

    // Client-safe exports
    expect(zodvex.zx).toBeDefined()
    expect(zodvex.zodToConvex).toBeDefined()
    expect(zodvex.zodToConvexFields).toBeDefined()
    expect(zodvex.convexCodec).toBeDefined()
    expect(zodvex.safePick).toBeDefined()
    expect(zodvex.decodeDoc).toBeDefined()
    expect(zodvex.encodeDoc).toBeDefined()
    expect(zodvex.encodePartialDoc).toBeDefined()

    // Deprecated root stubs stay client-safe and point callers at zodvex/legacy
    expectLegacyStub((zodvex as any).zodTable, 'zodTable')
    expectLegacyStub((zodvex as any).zQueryBuilder, 'zQueryBuilder')

    // Server-only exports must not leak from root
    expect(zodvex.customCtx).toBeUndefined()
    expect(zodvex.zCustomQuery).toBeUndefined()
    expect(zodvex.defineZodSchema).toBeUndefined()
    expect(zodvex.createZodDbReader).toBeUndefined()
    expect(zodvex.createZodDbWriter).toBeUndefined()
    expect(zodvex.initZodvex).toBeUndefined()
    expect(zodvex.createZodvexCustomization).toBeUndefined()
  })

  it('does NOT export internal symbols', async () => {
    const zodvex = await import('../src')
    expect((zodvex as any).customFnBuilder).toBeUndefined()
    expect((zodvex as any).attachMeta).toBeUndefined()
    expect((zodvex as any).readMeta).toBeUndefined()
    expect((zodvex as any).registryHelpers).toBeUndefined()
    expect((zodvex as any).pick).toBeUndefined()
    expect((zodvex as any).formatZodIssues).toBeUndefined()
    expect((zodvex as any).handleZodValidationError).toBeUndefined()
    expect((zodvex as any).validateReturns).toBeUndefined()
    expect((zodvex as any).assertNoNativeZodDate).toBeUndefined()
    expect((zodvex as any).makeUnion).toBeUndefined()
    expect((zodvex as any).isZodUnion).toBeUndefined()
    expect((zodvex as any).getUnionOptions).toBeUndefined()
    expect((zodvex as any).assertUnionOptions).toBeUndefined()
    expect((zodvex as any).createUnionFromOptions).toBeUndefined()
    expect((zodvex as any).composeCustomizations).toBeUndefined()
    expect((zodvex as any).createZodvexBuilder).toBeUndefined()
  })
})

describe('zodvex/legacy exports', () => {
  it('exports deprecated table helpers', async () => {
    const legacy = await import('../src/legacy')
    expect(legacy.zodTable).toBeDefined()
    expect(legacy.zodDoc).toBeDefined()
    expect(legacy.zodDocOrNull).toBeDefined()
  })

  it('exports deprecated builder helpers', async () => {
    const legacy = await import('../src/legacy')
    expect(legacy.zQueryBuilder).toBeDefined()
    expect(legacy.zMutationBuilder).toBeDefined()
    expect(legacy.zActionBuilder).toBeDefined()
    expect(legacy.zCustomQueryBuilder).toBeDefined()
    expect(legacy.zCustomMutationBuilder).toBeDefined()
    expect(legacy.zCustomActionBuilder).toBeDefined()
  })
})

describe('mini mirrored entrypoints', () => {
  it('exports the client helpers from zodvex/mini/client', async () => {
    const miniClient = await import('../src/mini/client')
    expect(miniClient.createZodvexClient).toBeDefined()
    expect(miniClient.ZodvexClient).toBeDefined()
  })

  it('exports the react helpers from zodvex/mini/react', async () => {
    const miniReact = await import('../src/mini/react')
    expect(miniReact.createZodvexHooks).toBeDefined()
    expect(miniReact.createZodvexReactClient).toBeDefined()
    expect(miniReact.ZodvexReactClient).toBeDefined()
  })
})
