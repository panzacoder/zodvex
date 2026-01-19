import { describe, expect, it } from 'bun:test'
import { v } from 'convex/values'
import { z } from 'zod'
import { zid } from '../src/ids'
import { zodToConvex } from '../src/mapping'
import { zodTable } from '../src/tables'

describe('zodTable - union support', () => {
  describe('Basic discriminated unions', () => {
    it('accepts simple discriminated union schema', () => {
      // Example from Issue #20
      const shapeSchema = z.union([
        z.object({
          kind: z.literal('circle'),
          cx: z.number(),
          cy: z.number(),
          r: z.number()
        }),
        z.object({
          kind: z.literal('rectangle'),
          x: z.number(),
          y: z.number(),
          width: z.number(),
          height: z.number()
        }),
        z.object({
          kind: z.literal('path'),
          path: z.string()
        })
      ])

      const Shapes = zodTable('shapes', shapeSchema)

      // Should have table property
      expect(Shapes.table).toBeDefined()
      expect(Shapes.tableName).toBe('shapes')

      // Should convert to proper Convex validator
      const expected = v.union(
        v.object({
          kind: v.literal('circle'),
          cx: v.float64(),
          cy: v.float64(),
          r: v.float64()
        }),
        v.object({
          kind: v.literal('rectangle'),
          x: v.float64(),
          y: v.float64(),
          width: v.float64(),
          height: v.float64()
        }),
        v.object({
          kind: v.literal('path'),
          path: v.string()
        })
      )

      expect(Shapes.validator).toEqual(expected)
    })

    it('handles discriminated union with shared base schema', () => {
      const baseShape = z.object({
        color: z.string(),
        strokeWidth: z.number(),
        isFilled: z.boolean().optional(),
        index: z.number()
      })

      const shapeSchema = z.union([
        baseShape.extend({
          kind: z.literal('circle'),
          r: z.number()
        }),
        baseShape.extend({
          kind: z.literal('rectangle'),
          width: z.number(),
          height: z.number()
        })
      ])

      const Shapes = zodTable('shapes', shapeSchema)

      expect(Shapes.table).toBeDefined()
      expect(Shapes.tableName).toBe('shapes')

      // Verify it's a union validator
      const validator = Shapes.validator as any
      expect(validator.kind).toBe('union')
      expect(validator.members).toHaveLength(2)
    })

    it('handles z.discriminatedUnion syntax', () => {
      const shapeSchema = z.discriminatedUnion('kind', [
        z.object({
          kind: z.literal('circle'),
          r: z.number()
        }),
        z.object({
          kind: z.literal('rectangle'),
          width: z.number()
        })
      ])

      const Shapes = zodTable('shapes', shapeSchema)

      expect(Shapes.table).toBeDefined()

      const validator = Shapes.validator as any
      expect(validator.kind).toBe('union')
      expect(validator.members).toHaveLength(2)
    })
  })

  describe('Non-discriminated unions', () => {
    it('handles union of different object types', () => {
      const schema = z.union([
        z.object({
          type: z.string(),
          data: z.string()
        }),
        z.object({
          id: z.number(),
          value: z.number()
        })
      ])

      const TestTable = zodTable('test', schema)

      expect(TestTable.table).toBeDefined()

      const validator = TestTable.validator as any
      expect(validator.kind).toBe('union')
      expect(validator.members).toHaveLength(2)
    })

    it('handles union with mixed types', () => {
      const schema = z.union([
        z.object({ name: z.string() }),
        z.object({ count: z.number() }),
        z.object({ active: z.boolean() })
      ])

      const TestTable = zodTable('test', schema)

      expect(TestTable.validator).toEqual(
        v.union(
          v.object({ name: v.string() }),
          v.object({ count: v.float64() }),
          v.object({ active: v.boolean() })
        )
      )
    })
  })

  describe('System fields helper - withSystemFields()', () => {
    it('adds _id and _creationTime to each union variant', () => {
      const shapeSchema = z.union([
        z.object({
          kind: z.literal('circle'),
          r: z.number()
        }),
        z.object({
          kind: z.literal('rectangle'),
          width: z.number()
        })
      ])

      const Shapes = zodTable('shapes', shapeSchema)

      // Should have withSystemFields method
      expect(Shapes.withSystemFields).toBeDefined()

      const withFields = Shapes.withSystemFields()

      // Should be a union schema
      expect(withFields).toBeInstanceOf(z.ZodUnion)

      // Each variant should have _id and _creationTime
      const options = (withFields as z.ZodUnion<any>).options

      expect(options).toHaveLength(2)

      // First variant (circle)
      const circleVariant = options[0] as z.ZodObject<any>
      const circleShape = circleVariant.shape
      expect(circleShape._id).toBeDefined()
      expect(circleShape._creationTime).toBeDefined()
      expect(circleShape.kind).toBeDefined()
      expect(circleShape.r).toBeDefined()

      // Second variant (rectangle)
      const rectVariant = options[1] as z.ZodObject<any>
      const rectShape = rectVariant.shape
      expect(rectShape._id).toBeDefined()
      expect(rectShape._creationTime).toBeDefined()
      expect(rectShape.kind).toBeDefined()
      expect(rectShape.width).toBeDefined()
    })

    it('preserves discriminator fields when adding system fields', () => {
      const schema = z.discriminatedUnion('type', [
        z.object({
          type: z.literal('user'),
          name: z.string()
        }),
        z.object({
          type: z.literal('admin'),
          permissions: z.array(z.string())
        })
      ])

      const Users = zodTable('users', schema)
      const withFields = Users.withSystemFields()

      const options = (withFields as z.ZodUnion<any>).options

      // Both variants should still have the discriminator
      const userVariant = options[0] as z.ZodObject<any>
      expect(userVariant.shape.type).toBeDefined()
      expect(userVariant.shape._id).toBeDefined()

      const adminVariant = options[1] as z.ZodObject<any>
      expect(adminVariant.shape.type).toBeDefined()
      expect(adminVariant.shape._id).toBeDefined()
    })

    it('handles nested objects within union variants', () => {
      const schema = z.union([
        z.object({
          kind: z.literal('complex'),
          data: z.object({
            nested: z.string(),
            values: z.array(z.number())
          })
        }),
        z.object({
          kind: z.literal('simple'),
          value: z.string()
        })
      ])

      const TestTable = zodTable('test', schema)
      const withFields = TestTable.withSystemFields()

      const options = (withFields as z.ZodUnion<any>).options

      // Complex variant should preserve nested structure
      const complexVariant = options[0] as z.ZodObject<any>
      expect(complexVariant.shape.data).toBeDefined()
      expect(complexVariant.shape._id).toBeDefined()
      expect(complexVariant.shape._creationTime).toBeDefined()

      // Nested object should be preserved
      const dataField = complexVariant.shape.data as z.ZodObject<any>
      expect(dataField.shape.nested).toBeDefined()
      expect(dataField.shape.values).toBeDefined()
    })
  })

  describe('Document array generation', () => {
    it('provides docArray with system fields', () => {
      const shapeSchema = z.union([
        z.object({
          kind: z.literal('circle'),
          r: z.number()
        }),
        z.object({
          kind: z.literal('rectangle'),
          width: z.number()
        })
      ])

      const Shapes = zodTable('shapes', shapeSchema)

      expect(Shapes.docArray).toBeDefined()

      // Should be an array schema
      expect(Shapes.docArray).toBeInstanceOf(z.ZodArray)

      // Element should be the union with system fields
      const elementType = (Shapes.docArray as z.ZodArray<any>).element
      expect(elementType).toBeInstanceOf(z.ZodUnion)

      // Each variant should have system fields
      const options = (elementType as z.ZodUnion<any>).options
      const circleVariant = options[0] as z.ZodObject<any>
      expect(circleVariant.shape._id).toBeDefined()
      expect(circleVariant.shape._creationTime).toBeDefined()
    })

    it('docArray can be used for function return types', () => {
      const schema = z.union([
        z.object({ type: z.literal('a'), value: z.string() }),
        z.object({ type: z.literal('b'), count: z.number() })
      ])

      const TestTable = zodTable('test', schema)

      // Should be able to parse array of docs
      const docs = [
        {
          _id: 'test_123' as any,
          _creationTime: 123456,
          type: 'a' as const,
          value: 'hello'
        },
        {
          _id: 'test_456' as any,
          _creationTime: 123457,
          type: 'b' as const,
          count: 42
        }
      ]

      const result = TestTable.docArray.parse(docs)
      expect(result).toEqual(docs)
    })
  })

  describe('Type depth and recursion safety', () => {
    it('handles deeply nested unions (3 levels)', () => {
      const level3 = z.union([
        z.object({ type: z.literal('l3a'), value: z.string() }),
        z.object({ type: z.literal('l3b'), value: z.number() })
      ])

      const level2 = z.union([
        z.object({ type: z.literal('l2a'), nested: level3 }),
        z.object({ type: z.literal('l2b'), data: z.string() })
      ])

      const level1 = z.union([
        z.object({ type: z.literal('l1a'), child: level2 }),
        z.object({ type: z.literal('l1b'), value: z.boolean() })
      ])

      const TestTable = zodTable('test', level1)

      expect(TestTable.table).toBeDefined()

      // Should convert without TypeScript depth errors
      const validator = TestTable.validator
      expect(validator).toBeDefined()
    })

    it('handles union with many variants (8 variants)', () => {
      const schema = z.union([
        z.object({ kind: z.literal('a'), data: z.string() }),
        z.object({ kind: z.literal('b'), data: z.string() }),
        z.object({ kind: z.literal('c'), data: z.string() }),
        z.object({ kind: z.literal('d'), data: z.string() }),
        z.object({ kind: z.literal('e'), data: z.string() }),
        z.object({ kind: z.literal('f'), data: z.string() }),
        z.object({ kind: z.literal('g'), data: z.string() }),
        z.object({ kind: z.literal('h'), data: z.string() })
      ])

      const TestTable = zodTable('test', schema)

      const validator = TestTable.validator as any
      expect(validator.kind).toBe('union')
      expect(validator.members).toHaveLength(8)
    })

    it('handles union containing objects with nested unions', () => {
      const nestedUnion = z.union([z.string(), z.number()])

      const schema = z.union([
        z.object({
          type: z.literal('a'),
          value: nestedUnion,
          other: z.string()
        }),
        z.object({
          type: z.literal('b'),
          data: z.array(nestedUnion)
        })
      ])

      const TestTable = zodTable('test', schema)

      expect(TestTable.validator).toBeDefined()

      // Verify nested unions are preserved
      const validator = TestTable.validator as any
      const firstVariant = validator.members[0] as any
      expect(firstVariant.fields.value.kind).toBe('union')
    })
  })

  describe('Edge cases', () => {
    it('handles single-variant union', () => {
      const schema = z.union([z.object({ value: z.string() })])

      const TestTable = zodTable('test', schema)

      expect(TestTable.table).toBeDefined()

      // Single-variant unions get optimized to the single object by zodToConvex
      const validator = TestTable.validator as any
      expect(validator.kind).toBe('object')
      expect(validator.fields.value).toBeDefined()
    })

    it('handles union with optional fields across variants', () => {
      const schema = z.union([
        z.object({
          type: z.literal('a'),
          required: z.string(),
          optional: z.number().optional()
        }),
        z.object({
          type: z.literal('b'),
          required: z.boolean(),
          different: z.string().optional()
        })
      ])

      const TestTable = zodTable('test', schema)

      const validator = TestTable.validator as any
      const firstVariant = validator.members[0] as any

      // Optional fields should be wrapped in v.optional
      expect(firstVariant.fields.optional.isOptional).toBe('optional')
      // Required fields have isOptional set to 'required' (not undefined)
      expect(firstVariant.fields.required.isOptional).toBe('required')
    })

    it('handles union with nullable fields', () => {
      const schema = z.union([
        z.object({
          type: z.literal('a'),
          nullable: z.string().nullable()
        }),
        z.object({
          type: z.literal('b'),
          optionalNullable: z.number().optional().nullable()
        })
      ])

      const TestTable = zodTable('test', schema)

      const validator = TestTable.validator as any

      // Nullable should be v.union(T, v.null())
      const firstVariant = validator.members[0] as any
      expect(firstVariant.fields.nullable.kind).toBe('union')

      // Optional nullable should be v.optional(v.union(T, v.null()))
      const secondVariant = validator.members[1] as any
      expect(secondVariant.fields.optionalNullable.isOptional).toBe('optional')
    })

    it('handles union with zid fields', () => {
      const schema = z.union([
        z.object({
          type: z.literal('user'),
          userId: zid('users')
        }),
        z.object({
          type: z.literal('team'),
          teamId: zid('teams')
        })
      ])

      const TestTable = zodTable('test', schema)

      const validator = TestTable.validator as any

      // zid should convert to v.id()
      const firstVariant = validator.members[0] as any
      expect(firstVariant.fields.userId).toEqual(v.id('users'))

      const secondVariant = validator.members[1] as any
      expect(secondVariant.fields.teamId).toEqual(v.id('teams'))
    })
  })

  describe('Backward compatibility with object shapes', () => {
    it('still accepts object shapes as before', () => {
      const testShape = {
        name: z.string(),
        age: z.number().optional()
      }

      const TestTable = zodTable('test', testShape)

      expect(TestTable.table).toBeDefined()
      expect(TestTable.shape).toEqual(testShape)
      expect(TestTable.zDoc).toBeDefined()
      expect(TestTable.docArray).toBeDefined()
    })

    it('maintains all existing helpers for object shapes', () => {
      const testShape = {
        title: z.string(),
        count: z.number()
      }

      const TestTable = zodTable('test', testShape)

      // Should have shape property (not available for unions)
      expect(TestTable.shape).toEqual(testShape)

      // Should have zDoc (object schema with system fields)
      expect(TestTable.zDoc).toBeInstanceOf(z.ZodObject)

      // Should have docArray
      expect(TestTable.docArray).toBeInstanceOf(z.ZodArray)
    })
  })

  describe('Schema namespace for unions', () => {
    it('provides schema.insert property with original union', () => {
      const shapeSchema = z.union([
        z.object({ kind: z.literal('a'), value: z.string() }),
        z.object({ kind: z.literal('b'), count: z.number() })
      ])

      const TestTable = zodTable('test', shapeSchema)

      // Should have schema.insert property with original union
      expect(TestTable.schema.insert).toBe(shapeSchema)
    })

    it('does not provide shape property for unions', () => {
      const shapeSchema = z.union([
        z.object({ kind: z.literal('a') }),
        z.object({ kind: z.literal('b') })
      ])

      const TestTable = zodTable('test', shapeSchema)

      // Unions don't have a fixed shape
      expect((TestTable as any).shape).toBeUndefined()
    })
  })
})
