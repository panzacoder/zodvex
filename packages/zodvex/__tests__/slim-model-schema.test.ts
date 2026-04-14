/**
 * Integration tests for slim models (schemaHelpers: false) through
 * defineZodSchema and the DB wrapper pipeline.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineZodModel } from '../src/internal/model'
import { defineZodSchema } from '../src/internal/schema'
import { zx } from '../src/internal/zx'

describe('slim model → defineZodSchema integration', () => {
  it('slim model registers successfully in defineZodSchema', () => {
    const TaskModel = defineZodModel(
      'tasks',
      {
        title: z.string(),
        done: z.boolean()
      },
      { schemaHelpers: false }
    )

    const schema = defineZodSchema({ tasks: TaskModel })
    expect(schema).toBeDefined()
    expect(schema.__zodTableMap).toHaveProperty('tasks')
  })

  it('zodTableMap has doc and insert for slim model', () => {
    const ItemModel = defineZodModel(
      'items',
      {
        name: z.string(),
        count: z.number()
      },
      { schemaHelpers: false }
    )

    const schema = defineZodSchema({ items: ItemModel })
    const tableSchemas = schema.__zodTableMap.items

    expect(tableSchemas.doc).toBeDefined()
    expect(tableSchemas.insert).toBeDefined()
    expect(tableSchemas.base).toBeDefined()
    expect(tableSchemas.update).toBeDefined()

    // Verify doc has system fields
    const docResult = tableSchemas.doc.safeParse({
      _id: 'item123',
      _creationTime: 100,
      name: 'Test',
      count: 42
    })
    expect(docResult.success).toBe(true)

    // Verify insert validates user fields only
    const insertResult = tableSchemas.insert.safeParse({
      name: 'Test',
      count: 42
    })
    expect(insertResult.success).toBe(true)
  })

  it('slim and full models can coexist in the same schema', () => {
    const SlimModel = defineZodModel(
      'slim_table',
      {
        title: z.string()
      },
      { schemaHelpers: false }
    )

    const FullModel = defineZodModel('full_table', {
      name: z.string(),
      email: z.string()
    })

    const schema = defineZodSchema({
      slim_table: SlimModel,
      full_table: FullModel
    })

    expect(schema.__zodTableMap).toHaveProperty('slim_table')
    expect(schema.__zodTableMap).toHaveProperty('full_table')
  })

  it('zx helpers work with slim models', () => {
    const Model = defineZodModel(
      'docs',
      {
        content: z.string()
      },
      { schemaHelpers: false }
    )

    // zx.doc() should produce same result as Model.doc
    const helperDoc = zx.doc(Model)
    const modelDoc = Model.doc

    const testData = {
      _id: 'doc123',
      _creationTime: 100,
      content: 'Hello'
    }

    expect(helperDoc.safeParse(testData).success).toBe(true)
    expect(modelDoc.safeParse(testData).success).toBe(true)

    // zx.update() should work
    const updateSchema = zx.update(Model)
    expect(updateSchema.safeParse({ _id: 'doc123' }).success).toBe(true)

    // zx.paginationResult() should work with Model.doc
    const paginated = zx.paginationResult(Model.doc)
    expect(
      paginated.safeParse({
        page: [testData],
        isDone: false,
        continueCursor: 'cursor'
      }).success
    ).toBe(true)
  })

  it('slim discriminated union model registers and populates zodTableMap', () => {
    const visitSchema = z.discriminatedUnion('type', [
      z.object({ type: z.literal('phone'), duration: z.number() }),
      z.object({ type: z.literal('in-person'), roomId: z.string() })
    ])

    const VisitModel = defineZodModel('visits', visitSchema, { schemaHelpers: false })
    const schema = defineZodSchema({ visits: VisitModel })
    const tableSchemas = schema.__zodTableMap.visits

    expect(tableSchemas.doc).toBeDefined()
    expect(tableSchemas.insert).toBeDefined()
    expect(tableSchemas.update).toBeDefined()

    // doc should validate union variants with system fields
    expect(
      tableSchemas.doc.safeParse({
        type: 'phone',
        duration: 30,
        _id: 'v1',
        _creationTime: 1
      }).success
    ).toBe(true)

    expect(
      tableSchemas.doc.safeParse({
        type: 'in-person',
        roomId: 'room1',
        _id: 'v2',
        _creationTime: 2
      }).success
    ).toBe(true)

    // update should be union-aware (partial variants with _id)
    expect(
      tableSchemas.update.safeParse({
        _id: 'v1',
        type: 'phone'
      }).success
    ).toBe(true)
  })
})
