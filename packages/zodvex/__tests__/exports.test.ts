import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('zodvex/core has no server runtime imports', () => {
  it('does not import from convex/server or convex-helpers/server at runtime', async () => {
    const coreIndex = await readFile(new URL('../src/core/index.ts', import.meta.url), 'utf-8')

    // Extract all re-export source paths, tracking which are type-only
    const typeOnlyPaths = new Set<string>()
    const runtimePaths = new Set<string>()

    for (const line of coreIndex.split('\n')) {
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
    const filesToCheck = pathsToCheck.map(p => {
      const resolved = p.startsWith('../') ? `${baseDir}${p.slice(3)}` : `${baseDir}core/${p}`
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
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*'))
          continue

        if (trimmed.includes("from 'convex/server'") || trimmed.includes('from "convex/server"')) {
          throw new Error(
            `Runtime import from 'convex/server' found in ${filePath}:\n  ${trimmed}\n` +
              `zodvex/core must be client-safe. Use 'import type' or move to zodvex/server.`
          )
        }
        if (
          trimmed.includes("from 'convex-helpers/server") ||
          trimmed.includes('from "convex-helpers/server')
        ) {
          throw new Error(
            `Runtime import from 'convex-helpers/server' found in ${filePath}:\n  ${trimmed}\n` +
              `zodvex/core must be client-safe. Use 'import type' or move to zodvex/server.`
          )
        }
      }
    }
  })
})

describe('zodvex/core exports', () => {
  it('exports zx namespace', async () => {
    const { zx } = await import('../src/core')
    expect(zx).toBeDefined()
    expect(zx.id).toBeDefined()
    expect(zx.date).toBeDefined()
  })

  it('exports zodToConvex', async () => {
    const { zodToConvex } = await import('../src/core')
    expect(zodToConvex).toBeDefined()
  })

  it('exports zodToConvexFields', async () => {
    const { zodToConvexFields } = await import('../src/core')
    expect(zodToConvexFields).toBeDefined()
  })

  it('exports createBoundaryHelpers', async () => {
    const { createBoundaryHelpers } = await import('../src/core')
    expect(createBoundaryHelpers).toBeDefined()
  })

  it('exports codec utilities', async () => {
    const { convexCodec, decodeDoc, encodeDoc, encodePartialDoc } = await import('../src/core')
    expect(convexCodec).toBeDefined()
    expect(decodeDoc).toBeDefined()
    expect(encodeDoc).toBeDefined()
    expect(encodePartialDoc).toBeDefined()
  })

  it('exports utility functions', async () => {
    const { safePick, safeOmit, zPaginated, stripUndefined } = await import('../src/core')
    expect(safePick).toBeDefined()
    expect(safeOmit).toBeDefined()
    expect(zPaginated).toBeDefined()
    expect(stripUndefined).toBeDefined()
  })

  it('exports JSON schema utilities', async () => {
    const { zodvexJSONSchemaOverride, toJSONSchema } = await import('../src/core')
    expect(zodvexJSONSchemaOverride).toBeDefined()
    expect(toJSONSchema).toBeDefined()
  })

  it('does NOT export zodTable', async () => {
    const core = await import('../src/core')
    expect((core as any).zodTable).toBeUndefined()
  })

  it('does NOT export customCtx', async () => {
    const core = await import('../src/core')
    expect((core as any).customCtx).toBeUndefined()
  })

  it('does NOT export zQueryBuilder', async () => {
    const core = await import('../src/core')
    expect((core as any).zQueryBuilder).toBeUndefined()
  })

  it('does NOT export zCustomQuery', async () => {
    const core = await import('../src/core')
    expect((core as any).zCustomQuery).toBeUndefined()
  })

  it('does NOT export internal meta utilities', async () => {
    const core = await import('../src/core')
    expect((core as any).attachMeta).toBeUndefined()
    expect((core as any).readMeta).toBeUndefined()
  })

  it('does NOT export internal mapping helpers', async () => {
    const core = await import('../src/core')
    expect((core as any).makeUnion).toBeUndefined()
  })

  it('does NOT export internal utils', async () => {
    const core = await import('../src/core')
    expect((core as any).pick).toBeUndefined()
    expect((core as any).formatZodIssues).toBeUndefined()
    expect((core as any).handleZodValidationError).toBeUndefined()
    expect((core as any).validateReturns).toBeUndefined()
    expect((core as any).assertNoNativeZodDate).toBeUndefined()
  })

  it('does NOT export internal id helpers', async () => {
    const core = await import('../src/core')
    expect((core as any).registryHelpers).toBeUndefined()
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
  it('exports everything for backwards compatibility', async () => {
    const zodvex = await import('../src')

    // Core exports
    expect(zodvex.zx).toBeDefined()
    expect(zodvex.zodToConvex).toBeDefined()
    expect(zodvex.zodToConvexFields).toBeDefined()
    expect(zodvex.convexCodec).toBeDefined()
    expect(zodvex.safePick).toBeDefined()

    // Server exports
    expect(zodvex.zodTable).toBeDefined()
    expect(zodvex.customCtx).toBeDefined()
    expect(zodvex.zQueryBuilder).toBeDefined()
    expect(zodvex.zCustomQuery).toBeDefined()

    // New codec DB exports
    expect(zodvex.decodeDoc).toBeDefined()
    expect(zodvex.encodeDoc).toBeDefined()
    expect(zodvex.encodePartialDoc).toBeDefined()
    expect(zodvex.defineZodSchema).toBeDefined()
    expect(zodvex.createZodDbReader).toBeDefined()
    expect(zodvex.createZodDbWriter).toBeDefined()
    expect(zodvex.initZodvex).toBeDefined()
    expect(zodvex.createZodvexCustomization).toBeDefined()
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
