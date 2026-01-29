import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { z } from 'zod'
import { zodTable } from '../src/tables'

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

  describe('deprecation warnings', () => {
    let consoleWarnSpy: ReturnType<typeof spyOn>

    beforeEach(() => {
      consoleWarnSpy = spyOn(console, 'warn').mockImplementation(() => {
        /* suppress warnings during tests */
      })
    })

    afterEach(() => {
      consoleWarnSpy.mockRestore()
    })

    it('warns when accessing zDoc', () => {
      const Users = zodTable('users', { name: z.string() })

      // First access should warn
      const _doc = Users.zDoc
      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('zDoc'))
      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('schema.doc'))
    })

    it('warns when accessing docArray', () => {
      const Users = zodTable('users', { name: z.string() })

      const _arr = Users.docArray
      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('docArray'))
      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('schema.docArray'))
    })

    it('only warns once per property per table', () => {
      const Users = zodTable('users', { name: z.string() })

      Users.zDoc
      Users.zDoc
      Users.zDoc

      // Should only have warned once for zDoc
      const zDocWarnings = consoleWarnSpy.mock.calls.filter((call: any[]) =>
        call[0]?.includes('zDoc')
      )
      expect(zDocWarnings.length).toBe(1)
    })
  })
})
