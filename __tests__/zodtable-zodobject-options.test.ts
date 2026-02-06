import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { zodTable } from '../src/tables'

/**
 * Tests to verify that ZodObject options are preserved when passed to zodTable.
 * Options like .passthrough(), .strict(), and .catchall() should be preserved
 * in schema.base/schema.insert for runtime validation.
 */
describe('zodTable ZodObject options preservation', () => {
  describe('raw shape (baseline)', () => {
    it('strips unknown keys by default', () => {
      const table = zodTable('test', {
        name: z.string()
      })

      const result = table.schema.base.safeParse({ name: 'test', extra: 'ignored' })

      expect(result.success).toBe(true)
      if (result.success) {
        expect('extra' in result.data).toBe(false)
      }
    })
  })

  describe('.passthrough()', () => {
    it('should preserve passthrough behavior in schema.base', () => {
      const schema = z
        .object({
          name: z.string()
        })
        .passthrough()

      const table = zodTable('test', schema)

      const result = table.schema.base.safeParse({ name: 'test', extra: 'kept' })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.extra).toBe('kept')
      }
    })

    it('should preserve passthrough behavior in schema.insert', () => {
      const schema = z
        .object({
          name: z.string()
        })
        .passthrough()

      const table = zodTable('test', schema)

      const result = table.schema.insert.safeParse({ name: 'test', extra: 'kept' })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.extra).toBe('kept')
      }
    })
  })

  describe('.strict()', () => {
    it('should preserve strict behavior in schema.base', () => {
      const schema = z
        .object({
          name: z.string()
        })
        .strict()

      const table = zodTable('test', schema)

      const result = table.schema.base.safeParse({ name: 'test', extra: 'rejected' })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0].code).toBe('unrecognized_keys')
      }
    })
  })

  describe('.catchall()', () => {
    it('should preserve catchall behavior in schema.base', () => {
      const schema = z
        .object({
          name: z.string()
        })
        .catchall(z.number())

      const table = zodTable('test', schema)

      // Extra keys should be validated as numbers
      const validResult = table.schema.base.safeParse({ name: 'test', extra: 42 })
      expect(validResult.success).toBe(true)

      const invalidResult = table.schema.base.safeParse({ name: 'test', extra: 'not a number' })
      expect(invalidResult.success).toBe(false)
    })
  })

  describe('schema.doc (with system fields)', () => {
    it('should add system fields without losing original options', () => {
      const schema = z
        .object({
          name: z.string()
        })
        .passthrough()

      const table = zodTable('test', schema)

      // schema.doc adds _id and _creationTime
      const result = table.schema.doc.safeParse({
        _id: 'test-id',
        _creationTime: Date.now(),
        name: 'test',
        extra: 'should be kept'
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data._id).toBe('test-id')
        expect(result.data.name).toBe('test')
        // Extra keys should be preserved due to passthrough
        expect(result.data.extra).toBe('should be kept')
      }
    })
  })
})
