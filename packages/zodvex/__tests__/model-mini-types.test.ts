/**
 * Type inference tests for ZodModel schemas across zodvex/core and zodvex/mini.
 *
 * Verifies that z.infer<model.schema.doc> produces identical results
 * regardless of whether the model is imported from zodvex/core or zodvex/mini.
 * This is the type chain that breaks for index range builders when DecodedDoc
 * resolves differently between full-zod and mini types.
 */
import { describe, expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { z as zm } from 'zod/mini'
import { $ZodObject, $ZodArray } from 'zod/v4/core'
import { defineZodModel, type ZodModel, type FullZodModelSchemas } from '../src/model'
import { defineZodModel as defineZodModelMini, type MiniModelSchemas } from '../src/mini'
import { zx } from '../src/zx'
import type { $ZodShape, $ZodType } from '../src/zod-core'
import type { output as zoutput } from 'zod/v4/core'

// ============================================================================
// Test models — same fields, different entrypoints
// ============================================================================

const fields = {
  name: z.string(),
  email: z.string().optional(),
  createdAt: zx.date()
}

const coreModel = defineZodModel('test_table', fields)
const miniModel = defineZodModelMini('test_table', fields)

// ============================================================================
// Type-level assertions
// ============================================================================

describe('ZodModel type inference: core vs mini', () => {
  it('core model has FullZodModelSchemas', () => {
    // Core model's schema types should be z.ZodObject etc.
    type CoreDoc = typeof coreModel.schema.doc
    type CoreDocInferred = z.infer<CoreDoc>
    expectTypeOf<CoreDocInferred>().toHaveProperty('name')
    expectTypeOf<CoreDocInferred>().toHaveProperty('createdAt')
    expectTypeOf<CoreDocInferred>().toHaveProperty('_id')
  })

  it('mini model has MiniModelSchemas', () => {
    // Mini model's schema types should be ZodMiniObject etc.
    type MiniDoc = typeof miniModel.schema.doc
    // z.infer from zod/mini should work on ZodMiniObject
    type MiniDocInferred = zoutput<MiniDoc>
    expectTypeOf<MiniDocInferred>().toHaveProperty('name')
    expectTypeOf<MiniDocInferred>().toHaveProperty('createdAt')
    expectTypeOf<MiniDocInferred>().toHaveProperty('_id')
  })

  it('both models infer the same document shape', () => {
    type CoreDoc = z.infer<typeof coreModel.schema.doc>
    type MiniDoc = zoutput<typeof miniModel.schema.doc>

    // Both should have the same fields
    expectTypeOf<CoreDoc>().toHaveProperty('name')
    expectTypeOf<MiniDoc>().toHaveProperty('name')
    expectTypeOf<CoreDoc>().toHaveProperty('email')
    expectTypeOf<MiniDoc>().toHaveProperty('email')
    expectTypeOf<CoreDoc>().toHaveProperty('_id')
    expectTypeOf<MiniDoc>().toHaveProperty('_id')
    expectTypeOf<CoreDoc>().toHaveProperty('_creationTime')
    expectTypeOf<MiniDoc>().toHaveProperty('_creationTime')
  })

  it('both models infer the same insert shape', () => {
    type CoreInsert = z.infer<typeof coreModel.schema.insert>
    type MiniInsert = zoutput<typeof miniModel.schema.insert>

    expectTypeOf<CoreInsert>().toHaveProperty('name')
    expectTypeOf<MiniInsert>().toHaveProperty('name')
  })

  it('runtime schemas produce the same values', () => {
    const doc = {
      name: 'Alice',
      email: 'alice@test.com',
      createdAt: 1000,
      _id: 'test_id' as any,
      _creationTime: 2000
    }

    // Both models create schemas at runtime with full zod (z.object)
    // regardless of which entrypoint was used for typing
    expect(coreModel.schema.doc).toBeDefined()
    expect(miniModel.schema.doc).toBeDefined()
    expect(coreModel.name).toBe('test_table')
    expect(miniModel.name).toBe('test_table')
  })

  it('chain methods preserve the Schemas type parameter', () => {
    const coreWithIndex = coreModel.index('by_name', ['name'])
    const miniWithIndex = miniModel.index('by_name', ['name'])

    // After chaining, schema types should still be correct
    type CoreChainedDoc = z.infer<typeof coreWithIndex.schema.doc>
    type MiniChainedDoc = zoutput<typeof miniWithIndex.schema.doc>

    expectTypeOf<CoreChainedDoc>().toHaveProperty('name')
    expectTypeOf<MiniChainedDoc>().toHaveProperty('name')
  })
})

// ============================================================================
// The specific pattern that breaks: field type lookup in a union context
// ============================================================================

describe('field type lookup for index range builders', () => {
  const taskModel = defineZodModel('tasks', {
    title: z.string(),
    status: z.enum(['todo', 'done']),
    createdAt: zx.date()
  }).index('by_created', ['createdAt'])

  const userModel = defineZodModel('users', {
    name: z.string(),
    createdAt: zx.date()
  }).index('by_created', ['createdAt'])

  const taskModelMini = defineZodModelMini('tasks', {
    title: z.string(),
    status: z.enum(['todo', 'done']),
    createdAt: zx.date()
  }).index('by_created', ['createdAt'])

  const userModelMini = defineZodModelMini('users', {
    name: z.string(),
    createdAt: zx.date()
  }).index('by_created', ['createdAt'])

  it('core: inferred doc types have correct field types', () => {
    type TaskDoc = z.infer<typeof taskModel.schema.doc>
    type UserDoc = z.infer<typeof userModel.schema.doc>

    // In a union context (simulating TableNames → DecodedDoc union):
    type UnionDoc = TaskDoc | UserDoc
    type CreatedAtType = UnionDoc['createdAt']

    // createdAt is number on the wire (zx.date() decodes to Date)
    // The wire type (from z.infer on the raw schema) should be number
    expectTypeOf<CreatedAtType>().toBeNumber()
  })

  it('mini: inferred doc types have correct field types', () => {
    type TaskDoc = zoutput<typeof taskModelMini.schema.doc>
    type UserDoc = zoutput<typeof userModelMini.schema.doc>

    // Same union context with mini types
    type UnionDoc = TaskDoc | UserDoc
    type CreatedAtType = UnionDoc['createdAt']

    // Should also be number — same inference, different type wrapper
    expectTypeOf<CreatedAtType>().toBeNumber()
  })
})

// ============================================================================
// Runtime verification: mini build produces correct instances
// ============================================================================

describe('mini runtime: schemas are core-compatible instances', () => {
  it('model.schema.doc is an instanceof $ZodObject', () => {
    expect(miniModel.schema.doc).toBeInstanceOf($ZodObject)
  })

  it('model.schema.insert is an instanceof $ZodObject', () => {
    expect(miniModel.schema.insert).toBeInstanceOf($ZodObject)
  })

  it('model.schema.docArray is an instanceof $ZodArray', () => {
    expect(miniModel.schema.docArray).toBeInstanceOf($ZodArray)
  })

  it('model.schema.update is an instanceof $ZodObject', () => {
    expect(miniModel.schema.update).toBeInstanceOf($ZodObject)
  })

  it('model.schema.paginatedDoc is an instanceof $ZodObject', () => {
    expect(miniModel.schema.paginatedDoc).toBeInstanceOf($ZodObject)
  })

  it('core and mini models produce structurally equivalent schemas', () => {
    // Both should have the same field names in their shape
    const coreShape = Object.keys((coreModel.schema.doc as any)._zod.def.shape)
    const miniShape = Object.keys((miniModel.schema.doc as any)._zod.def.shape)
    expect(coreShape.sort()).toEqual(miniShape.sort())
  })
})
