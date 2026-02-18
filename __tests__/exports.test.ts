import { describe, expect, it } from 'bun:test'

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

  it('exports codec utilities', async () => {
    const { convexCodec } = await import('../src/core')
    expect(convexCodec).toBeDefined()
  })

  it('exports transform utilities', async () => {
    const { transformBySchema, walkSchema } = await import('../src/core')
    expect(transformBySchema).toBeDefined()
    expect(walkSchema).toBeDefined()
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

  it('does NOT export server-only symbols', async () => {
    const core = await import('../src/core')
    expect((core as any).zodTable).toBeUndefined()
    expect((core as any).customCtx).toBeUndefined()
    expect((core as any).zQueryBuilder).toBeUndefined()
    expect((core as any).zCustomQuery).toBeUndefined()
    expect((core as any).initZodvex).toBeUndefined()
  })
})

describe('zodvex/server exports', () => {
  it('exports initZodvex', async () => {
    const { initZodvex } = await import('../src/server')
    expect(initZodvex).toBeDefined()
  })

  it('exports zodTable and defineZodSchema', async () => {
    const { zodTable, defineZodSchema } = await import('../src/server')
    expect(zodTable).toBeDefined()
    expect(defineZodSchema).toBeDefined()
  })

  it('exports customCtx (re-exported from convex-helpers)', async () => {
    const { customCtx } = await import('../src/server')
    expect(customCtx).toBeDefined()
  })

  it('exports Tier 2 builders: zCustomQuery, zCustomMutation, zCustomAction', async () => {
    const { zCustomQuery, zCustomMutation, zCustomAction } = await import('../src/server')
    expect(zCustomQuery).toBeDefined()
    expect(zCustomMutation).toBeDefined()
    expect(zCustomAction).toBeDefined()
  })

  it('exports Tier 3 builders: zQueryBuilder, zMutationBuilder, zActionBuilder', async () => {
    const { zQueryBuilder, zMutationBuilder, zActionBuilder } = await import('../src/server')
    expect(zQueryBuilder).toBeDefined()
    expect(zMutationBuilder).toBeDefined()
    expect(zActionBuilder).toBeDefined()
  })

  it('exports customFnBuilder (low-level escape hatch)', async () => {
    const { customFnBuilder } = await import('../src/server')
    expect(customFnBuilder).toBeDefined()
  })

  it('exports DB codec primitives', async () => {
    const { decodeDoc, encodeDoc, createZodDbReader, createZodDbWriter } = await import(
      '../src/server'
    )
    expect(decodeDoc).toBeDefined()
    expect(encodeDoc).toBeDefined()
    expect(createZodDbReader).toBeDefined()
    expect(createZodDbWriter).toBeDefined()
  })

  it('exports RuntimeDoc and WireDoc types (via type re-export)', async () => {
    // Types are erased at runtime, so we verify the module re-exports them
    // by checking that the db wrapper module is importable and the type names
    // resolve. A compile-time check is the real verification (bun run type-check).
    const db = await import('../src/db/wrapper')
    // These are type-only exports — we just verify the module loads cleanly
    expect(db.createZodDbReader).toBeDefined()
    expect(db.createZodDbWriter).toBeDefined()
  })

  it('exports deprecated symbols for backward compat', async () => {
    const {
      zCustomQueryBuilder,
      zCustomMutationBuilder,
      zCustomActionBuilder,
      customCtxWithHooks
    } = await import('../src/server')
    expect(zCustomQueryBuilder).toBeDefined()
    expect(zCustomMutationBuilder).toBeDefined()
    expect(zCustomActionBuilder).toBeDefined()
    expect(customCtxWithHooks).toBeDefined()
  })

  it('does NOT export removed symbols', async () => {
    const server = await import('../src/server')
    expect((server as any).createDatabaseHooks).toBeUndefined()
    expect((server as any).composeHooks).toBeUndefined()
    expect((server as any).DatabaseHooks).toBeUndefined()
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
    expect(zodvex.initZodvex).toBeDefined()
    expect(zodvex.zQueryBuilder).toBeDefined()
    expect(zodvex.zCustomQuery).toBeDefined()
  })
})
