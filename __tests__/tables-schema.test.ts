import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { z } from 'zod'
import { zodTable } from '../src/tables'
import { zx } from '../src/zx'

describe('zodTable schema namespace', () => {
  describe('object shapes', () => {
    it('provides schema.doc with system fields', () => {
      const Users = zodTable('users', {
        name: z.string(),
        email: z.string().email()
      })

      expect(Users.schema).toBeDefined()
      expect(Users.schema.doc).toBeInstanceOf(z.ZodObject)

      // Should have system fields
      const shape = Users.schema.doc.shape
      expect(shape._id).toBeDefined()
      expect(shape._creationTime).toBeDefined()
      expect(shape.name).toBeDefined()
      expect(shape.email).toBeDefined()
    })

    it('provides schema.docArray', () => {
      const Users = zodTable('users', {
        name: z.string()
      })

      expect(Users.schema.docArray).toBeInstanceOf(z.ZodArray)

      // Element should be doc schema
      const element = Users.schema.docArray.element
      expect(element).toBe(Users.schema.doc)
    })

    it('schema.doc equals deprecated zDoc', () => {
      const Users = zodTable('users', { name: z.string() })
      expect(Users.schema.doc).toBe(Users.zDoc)
    })

    it('schema.docArray equals deprecated docArray', () => {
      const Users = zodTable('users', { name: z.string() })
      expect(Users.schema.docArray).toBe(Users.docArray)
    })
  })

  describe('schema.update', () => {
    it('provides update schema with _id required, _creationTime optional, user fields partial', () => {
      const Users = zodTable('users', {
        name: z.string(),
        email: z.string().email(),
        age: z.number()
      })

      expect(Users.schema.update).toBeInstanceOf(z.ZodObject)

      // _id is required, user fields are optional
      const result = Users.schema.update.parse({ _id: 'users:123' as any })
      expect(result._id).toBe('users:123')

      const partial = Users.schema.update.parse({ _id: 'users:123' as any, name: 'John' })
      expect(partial).toEqual({ _id: 'users:123', name: 'John' })
    })

    it('update schema validates field types correctly', () => {
      const Users = zodTable('users', {
        name: z.string(),
        age: z.number()
      })

      // Valid partial update with _id
      const valid = Users.schema.update.parse({ _id: 'users:123' as any, age: 30 })
      expect(valid).toEqual({ _id: 'users:123', age: 30 })

      // Invalid type should fail
      expect(() => Users.schema.update.parse({ _id: 'users:123' as any, age: 'thirty' })).toThrow()
    })

    it('update schema includes _id required and _creationTime optional', () => {
      const Users = zodTable('users', { name: z.string() })

      const shape = Users.schema.update.shape
      expect(shape.name).toBeDefined()
      expect(shape._id).toBeDefined()
      expect(shape._creationTime).toBeDefined()

      // _id is required
      expect(() => Users.schema.update.parse({})).toThrow()

      // _creationTime is optional
      const valid = Users.schema.update.parse({ _id: 'users:123' as any })
      expect(valid._id).toBe('users:123')
    })

    it('handles already-optional fields correctly', () => {
      const Users = zodTable('users', {
        name: z.string(),
        nickname: z.string().optional()
      })

      // Both user fields should be optional in update schema, but _id is required
      const result = Users.schema.update.parse({ _id: 'users:123' as any })
      expect(result._id).toBe('users:123')

      const withNickname = Users.schema.update.parse({
        _id: 'users:123' as any,
        nickname: 'Johnny'
      })
      expect(withNickname).toEqual({ _id: 'users:123', nickname: 'Johnny' })
    })
  })

  describe('schema.base', () => {
    it('provides base schema with user fields only (no system fields)', () => {
      const Users = zodTable('users', {
        name: z.string(),
        email: z.string().email()
      })

      expect(Users.schema.base).toBeInstanceOf(z.ZodObject)

      const shape = Users.schema.base.shape
      expect(shape.name).toBeDefined()
      expect(shape.email).toBeDefined()

      // Should NOT have system fields
      expect(shape._id).toBeUndefined()
      expect(shape._creationTime).toBeUndefined()
    })

    it('base and insert are the same schema', () => {
      const Users = zodTable('users', { name: z.string() })

      expect(Users.schema.base).toBe(Users.schema.insert)
    })
  })

  describe('schema.insert', () => {
    it('provides insert schema with user fields only (no system fields)', () => {
      const Users = zodTable('users', {
        name: z.string(),
        email: z.string().email(),
        age: z.number().optional()
      })

      expect(Users.schema.insert).toBeInstanceOf(z.ZodObject)

      const shape = Users.schema.insert.shape
      expect(shape.name).toBeDefined()
      expect(shape.email).toBeDefined()
      expect(shape.age).toBeDefined()

      // Should NOT have system fields
      expect(shape._id).toBeUndefined()
      expect(shape._creationTime).toBeUndefined()
    })

    it('insert schema validates correctly', () => {
      const Users = zodTable('users', {
        name: z.string(),
        email: z.string().email()
      })

      const valid = Users.schema.insert.parse({ name: 'John', email: 'john@example.com' })
      expect(valid).toEqual({ name: 'John', email: 'john@example.com' })

      expect(() => Users.schema.insert.parse({ name: 'John' })).toThrow() // missing email
    })

    it('insert schema can be extended with .omit()', () => {
      const Users = zodTable('users', {
        name: z.string(),
        userId: z.string(),
        createdAt: z.number()
      })

      const CreateInput = Users.schema.insert.omit({ userId: true, createdAt: true })

      const valid = CreateInput.parse({ name: 'John' })
      expect(valid).toEqual({ name: 'John' })
    })
  })

  describe('union schemas', () => {
    it('provides schema.doc for unions', () => {
      const Shapes = zodTable(
        'shapes',
        z.union([
          z.object({ kind: z.literal('circle'), r: z.number() }),
          z.object({ kind: z.literal('rect'), w: z.number() })
        ])
      )

      expect(Shapes.schema).toBeDefined()
      expect(Shapes.schema.doc).toBeInstanceOf(z.ZodUnion)

      // Each variant should have system fields
      const options = Shapes.schema.doc.options
      expect(options[0].shape._id).toBeDefined()
      expect(options[0].shape._creationTime).toBeDefined()
    })

    it('provides schema.docArray for unions', () => {
      const Shapes = zodTable(
        'shapes',
        z.union([
          z.object({ kind: z.literal('circle'), r: z.number() }),
          z.object({ kind: z.literal('rect'), w: z.number() })
        ])
      )

      expect(Shapes.schema.docArray).toBeInstanceOf(z.ZodArray)
    })

    it('provides schema.base for unions (original schema)', () => {
      const shapeSchema = z.union([
        z.object({ kind: z.literal('circle'), r: z.number() }),
        z.object({ kind: z.literal('rect'), w: z.number() })
      ])
      const Shapes = zodTable('shapes', shapeSchema)

      // Base should be the original schema (no system fields)
      expect(Shapes.schema.base).toBe(shapeSchema)
    })

    it('provides schema.insert as alias for base (unions)', () => {
      const shapeSchema = z.union([
        z.object({ kind: z.literal('circle'), r: z.number() }),
        z.object({ kind: z.literal('rect'), w: z.number() })
      ])
      const Shapes = zodTable('shapes', shapeSchema)

      // Insert should be alias for base
      expect(Shapes.schema.insert).toBe(Shapes.schema.base)
    })

    it('provides schema.update for unions (_id required, user fields partial)', () => {
      const Shapes = zodTable(
        'shapes',
        z.union([
          z.object({ kind: z.literal('circle'), r: z.number() }),
          z.object({ kind: z.literal('rect'), w: z.number() })
        ])
      )

      expect(Shapes.schema.update).toBeInstanceOf(z.ZodUnion)

      // Each variant has _id required and user fields partial
      const result = Shapes.schema.update.parse({ _id: 'shapes:123' as any, kind: 'circle' })
      expect(result._id).toBe('shapes:123')
      expect(result.kind).toBe('circle') // r is now optional
    })
  })

  describe('deprecated properties (backward compatibility)', () => {
    // These properties are deprecated but still work for backward compatibility
    // Deprecation is now via TypeScript @deprecated JSDoc annotations, not runtime warnings

    it('zDoc still returns the document schema', () => {
      const Users = zodTable('users', { name: z.string() })

      // Deprecated but still works
      expect(Users.zDoc).toBe(Users.schema.doc)
    })

    it('docArray still returns the array schema', () => {
      const Users = zodTable('users', { name: z.string() })

      // Deprecated but still works
      expect(Users.docArray).toBe(Users.schema.docArray)
    })
  })

  describe('codec wire format in doc/docArray (issue #37)', () => {
    it('doc schema uses wire format for zx.date() fields', () => {
      const Events = zodTable('events', {
        name: z.string(),
        createdAt: zx.date()
      })

      // doc schema should accept wire-format data (numbers for dates)
      const wireData = {
        _id: 'events:123' as any,
        _creationTime: Date.now(),
        name: 'test event',
        createdAt: 1718452800000 // number, not Date
      }

      const result = Events.schema.doc.safeParse(wireData)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.createdAt).toBe(1718452800000)
        expect(typeof result.data.createdAt).toBe('number')
      }
    })

    it('doc schema rejects non-number for zx.date() fields', () => {
      const Events = zodTable('events', {
        name: z.string(),
        createdAt: zx.date()
      })

      const invalidData = {
        _id: 'events:123' as any,
        _creationTime: Date.now(),
        name: 'test event',
        createdAt: 'not-a-number'
      }

      const result = Events.schema.doc.safeParse(invalidData)
      expect(result.success).toBe(false)
    })

    it('docArray schema validates array of wire-format documents', () => {
      const Events = zodTable('events', {
        name: z.string(),
        createdAt: zx.date()
      })

      const wireData = [
        {
          _id: 'events:1' as any,
          _creationTime: Date.now(),
          name: 'event 1',
          createdAt: 1718452800000
        },
        {
          _id: 'events:2' as any,
          _creationTime: Date.now(),
          name: 'event 2',
          createdAt: 1718539200000
        }
      ]

      const result = Events.schema.docArray.safeParse(wireData)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.length).toBe(2)
        expect(typeof result.data[0].createdAt).toBe('number')
      }
    })

    it('z.encode on doc schema passes through wire-format data', () => {
      const Events = zodTable('events', {
        name: z.string(),
        createdAt: zx.date()
      })

      const wireData = {
        _id: 'events:123' as any,
        _creationTime: Date.now(),
        name: 'test',
        createdAt: 1718452800000
      }

      // z.encode should work with wire-format data (no codec to encode)
      const encoded = z.encode(Events.schema.doc, wireData)
      expect(encoded.createdAt).toBe(1718452800000)
    })

    it('handles optional zx.date() fields in doc schema', () => {
      const Events = zodTable('events', {
        name: z.string(),
        updatedAt: zx.date().optional()
      })

      // Without optional field
      const withoutDate = {
        _id: 'events:123' as any,
        _creationTime: Date.now(),
        name: 'test'
      }
      expect(Events.schema.doc.safeParse(withoutDate).success).toBe(true)

      // With optional field as number
      const withDate = {
        ...withoutDate,
        updatedAt: 1718452800000
      }
      expect(Events.schema.doc.safeParse(withDate).success).toBe(true)
    })

    it('handles nullable zx.date() fields in doc schema', () => {
      const Events = zodTable('events', {
        name: z.string(),
        deletedAt: zx.date().nullable()
      })

      // With null
      const withNull = {
        _id: 'events:123' as any,
        _creationTime: Date.now(),
        name: 'test',
        deletedAt: null
      }
      expect(Events.schema.doc.safeParse(withNull).success).toBe(true)

      // With number
      const withNumber = {
        ...withNull,
        deletedAt: 1718452800000
      }
      expect(Events.schema.doc.safeParse(withNumber).success).toBe(true)
    })

    it('non-codec fields are unaffected in doc schema', () => {
      const Events = zodTable('events', {
        name: z.string(),
        count: z.number(),
        createdAt: zx.date()
      })

      const wireData = {
        _id: 'events:123' as any,
        _creationTime: Date.now(),
        name: 'test',
        count: 42,
        createdAt: 1718452800000
      }

      const result = Events.schema.doc.safeParse(wireData)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.name).toBe('test')
        expect(result.data.count).toBe(42)
      }
    })

    it('base/insert schemas preserve codec fields (for encoding)', () => {
      const Events = zodTable('events', {
        name: z.string(),
        createdAt: zx.date()
      })

      // base/insert should still work with Date objects (runtime type)
      // because they're used for encoding user input, not Convex query results
      const now = new Date('2024-06-15T12:00:00.000Z')
      const runtimeData = {
        name: 'test',
        createdAt: now
      }

      // The base schema should parse runtime data (decode wire → runtime)
      // First encode the data to wire format, then parse it
      const wireData = z.encode(Events.schema.base, runtimeData)
      expect(typeof wireData.createdAt).toBe('number')
      expect(wireData.createdAt).toBe(now.getTime())

      // And parse (decode) it back
      const decoded = Events.schema.base.parse(wireData)
      expect(decoded.createdAt).toBeInstanceOf(Date)
    })
  })
})
