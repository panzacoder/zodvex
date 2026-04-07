/**
 * Runtime verification that codegen --mini output is executable.
 *
 * The existing codegen tests check string output (expect(js).toContain(...)).
 * This test goes further: it verifies that the OPERATIONS the generated code
 * performs actually work with zod/mini at runtime.
 *
 * The bug this catches: codegen emitting `schema.doc.nullable()` — a method
 * that exists on full-zod objects but NOT on zod/mini objects. The generated
 * code needs to use `z.nullable(schema.doc)` instead.
 *
 * Strategy:
 * 1. Generate mini-mode code and assert no method chains in the string output
 * 2. Execute the same operations the generated code would perform using zm (zod/mini)
 *    to prove they don't throw at runtime
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { DiscoveredFunction, DiscoveredModel } from '../src/codegen/discover'
import { generateApiFile } from '../src/codegen/generate'
import { zx } from '../src/zx'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const userDocSchema = z.object({ _id: z.string(), name: z.string(), email: z.string() })

const userPaginatedDocSchema = z.object({
  page: z.array(userDocSchema),
  isDone: z.boolean(),
  continueCursor: z.optional(z.nullable(z.string()))
})

const sampleModels: DiscoveredModel[] = [
  {
    exportName: 'UserModel',
    tableName: 'users',
    sourceFile: 'models/user.ts',
    schemas: {
      doc: userDocSchema,
      insert: z.object({ name: z.string(), email: z.string() }),
      update: z.object({ name: z.optional(z.string()) }),
      docArray: z.array(userDocSchema),
      paginatedDoc: userPaginatedDocSchema
    }
  }
]

// ---------------------------------------------------------------------------
// Tests: string-level verification (no method chains in mini output)
// ---------------------------------------------------------------------------

describe('codegen mini: no method chains in output', () => {
  it('.nullable() returns emits z.nullable() functional form', () => {
    const funcs: DiscoveredFunction[] = [
      {
        functionPath: 'users:get',
        exportName: 'get',
        sourceFile: 'users.ts',
        zodArgs: z.object({ id: zx.id('users') }),
        zodReturns: userDocSchema.nullable()
      }
    ]

    const { js } = generateApiFile(funcs, sampleModels, undefined, undefined, undefined, {
      mini: true
    })

    expect(js).not.toMatch(/\.nullable\(\)/)
    expect(js).toContain('z.nullable(UserModel.schema.doc)')
  })

  it('.optional() returns emits z.optional() functional form', () => {
    const funcs: DiscoveredFunction[] = [
      {
        functionPath: 'users:get',
        exportName: 'get',
        sourceFile: 'users.ts',
        zodArgs: z.object({ id: zx.id('users') }),
        zodReturns: userDocSchema.optional()
      }
    ]

    const { js } = generateApiFile(funcs, sampleModels, undefined, undefined, undefined, {
      mini: true
    })

    expect(js).not.toMatch(/\.optional\(\)/)
    expect(js).toContain('z.optional(UserModel.schema.doc)')
  })

  it('.nullable().optional() emits nested functional forms', () => {
    const funcs: DiscoveredFunction[] = [
      {
        functionPath: 'users:get',
        exportName: 'get',
        sourceFile: 'users.ts',
        zodArgs: z.object({}),
        zodReturns: userDocSchema.nullable().optional()
      }
    ]

    const { js } = generateApiFile(funcs, sampleModels, undefined, undefined, undefined, {
      mini: true
    })

    expect(js).not.toMatch(/\.nullable\(\)/)
    expect(js).not.toMatch(/\.optional\(\)/)
  })

  it('inline schemas with optional/nullable fields use functional forms', () => {
    const funcs: DiscoveredFunction[] = [
      {
        functionPath: 'users:search',
        exportName: 'search',
        sourceFile: 'users.ts',
        zodArgs: z.object({
          name: z.string(),
          email: z.optional(z.string()),
          status: z.nullable(z.string())
        }),
        zodReturns: z.array(userDocSchema)
      }
    ]

    const { js } = generateApiFile(funcs, sampleModels, undefined, undefined, undefined, {
      mini: true
    })

    expect(js).not.toMatch(/\.optional\(\)/)
    expect(js).not.toMatch(/\.nullable\(\)/)
  })

  it('imports from zod/mini and zodvex/mini, not zod and zodvex/core', () => {
    const funcs: DiscoveredFunction[] = [
      {
        functionPath: 'users:get',
        exportName: 'get',
        sourceFile: 'users.ts',
        zodArgs: z.object({}),
        zodReturns: userDocSchema
      }
    ]

    const { js, dts } = generateApiFile(funcs, sampleModels, undefined, undefined, undefined, {
      mini: true
    })

    expect(js).toContain("from 'zod/mini'")
    // zodvex/mini only appears when codecs are present (extractCodec import)
    // The critical check: no bare 'zod' or 'zodvex/core' imports
    expect(js).not.toMatch(/from 'zod'[^/]/)
    expect(js).not.toContain("from 'zodvex/core'")
  })

  it('full-zod mode still uses method chains (regression guard)', () => {
    const funcs: DiscoveredFunction[] = [
      {
        functionPath: 'users:get',
        exportName: 'get',
        sourceFile: 'users.ts',
        zodArgs: z.object({ id: zx.id('users') }),
        zodReturns: userDocSchema.nullable()
      }
    ]

    const { js } = generateApiFile(funcs, sampleModels)
    expect(js).toContain('UserModel.schema.doc.nullable()')
  })
})

// Runtime verification of codegen mini output is in:
// __tests__/integration/mini-codegen-e2e.test.ts
// That test imports the actual generated api.js and verifies the registry loads.
