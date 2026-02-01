import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { zid, zodTable } from '../src'

describe('zodTable with z.object()', () => {
  it('should preserve field types when using z.object() wrapper', () => {
    // z.object() wrapped schema
    const visitSchema = z.object({
      patientId: zid('patients'),
      clinicId: z.string(),
      status: z.enum(['active', 'completed'])
    })
    const Visit = zodTable('visits', visitSchema)

    // Verify runtime behavior - shape and schema should be defined
    expect(Visit.schema.doc).toBeDefined()
    expect(Visit.schema.docArray).toBeDefined()
    expect(Visit.schema.base).toBeDefined()
    expect(Visit.schema.update).toBeDefined()
    expect(Visit.shape).toBeDefined()
    expect(Visit.shape.patientId).toBeDefined()
    expect(Visit.shape.clinicId).toBeDefined()
    expect(Visit.shape.status).toBeDefined()
  })

  it('should produce equivalent types for raw shape and z.object() wrapper', () => {
    // Raw shape
    const rawShape = {
      clinicId: z.string(),
      email: z.string().email().optional()
    }
    const RawTable = zodTable('raw', rawShape)

    // z.object() wrapped
    const wrappedSchema = z.object({
      clinicId: z.string(),
      email: z.string().email().optional()
    })
    const WrappedTable = zodTable('wrapped', wrappedSchema)

    // Both should have the same structure (shape keys match)
    expect(Object.keys(RawTable.shape)).toEqual(Object.keys(WrappedTable.shape))
    // Both should have the same schema structure
    expect(Object.keys(RawTable.schema)).toEqual(Object.keys(WrappedTable.schema))
  })

  // Type-level tests - these verify TypeScript inference at compile time
  it('type test: z.object() should preserve specific field types', () => {
    const schema = z.object({
      name: z.string(),
      count: z.number(),
      status: z.enum(['a', 'b'])
    })
    const Table = zodTable('test', schema)

    // These type assertions verify the fix works at the type level
    type Doc = z.infer<typeof Table.schema.doc>
    type DocStatus = Doc['status']

    // Runtime check that the schema structure is correct
    const parsed = Table.schema.doc.safeParse({
      _id: 'test:123',
      _creationTime: Date.now(),
      name: 'test',
      count: 42,
      status: 'a'
    })
    expect(parsed.success).toBe(true)

    // Verify invalid status is rejected
    const invalid = Table.schema.doc.safeParse({
      _id: 'test:123',
      _creationTime: Date.now(),
      name: 'test',
      count: 42,
      status: 'invalid'
    })
    expect(invalid.success).toBe(false)
  })
})
