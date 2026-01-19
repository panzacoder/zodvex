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
    it('provides update schema with all fields partial', () => {
      const Users = zodTable('users', {
        name: z.string(),
        email: z.string().email(),
        age: z.number()
      })

      expect(Users.schema.update).toBeInstanceOf(z.ZodObject)

      // All fields should be optional
      const result = Users.schema.update.parse({})
      expect(result).toEqual({})

      const partial = Users.schema.update.parse({ name: 'John' })
      expect(partial).toEqual({ name: 'John' })
    })

    it('update schema validates field types correctly', () => {
      const Users = zodTable('users', {
        name: z.string(),
        age: z.number()
      })

      // Valid partial update
      const valid = Users.schema.update.parse({ age: 30 })
      expect(valid).toEqual({ age: 30 })

      // Invalid type should fail
      expect(() => Users.schema.update.parse({ age: 'thirty' })).toThrow()
    })

    it('update schema does not include system fields', () => {
      const Users = zodTable('users', { name: z.string() })

      const shape = Users.schema.update.shape
      expect(shape.name).toBeDefined()
      expect(shape._id).toBeUndefined()
      expect(shape._creationTime).toBeUndefined()
    })

    it('handles already-optional fields correctly', () => {
      const Users = zodTable('users', {
        name: z.string(),
        nickname: z.string().optional()
      })

      // Both should be optional in update schema
      const result = Users.schema.update.parse({})
      expect(result).toEqual({})

      const withNickname = Users.schema.update.parse({ nickname: 'Johnny' })
      expect(withNickname).toEqual({ nickname: 'Johnny' })
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
      const Shapes = zodTable('shapes', z.union([
        z.object({ kind: z.literal('circle'), r: z.number() }),
        z.object({ kind: z.literal('rect'), w: z.number() })
      ]))

      expect(Shapes.schema).toBeDefined()
      expect(Shapes.schema.doc).toBeInstanceOf(z.ZodUnion)

      // Each variant should have system fields
      const options = Shapes.schema.doc.options
      expect(options[0].shape._id).toBeDefined()
      expect(options[0].shape._creationTime).toBeDefined()
    })

    it('provides schema.docArray for unions', () => {
      const Shapes = zodTable('shapes', z.union([
        z.object({ kind: z.literal('circle'), r: z.number() }),
        z.object({ kind: z.literal('rect'), w: z.number() })
      ]))

      expect(Shapes.schema.docArray).toBeInstanceOf(z.ZodArray)
    })

    it('provides schema.insert for unions (original schema)', () => {
      const shapeSchema = z.union([
        z.object({ kind: z.literal('circle'), r: z.number() }),
        z.object({ kind: z.literal('rect'), w: z.number() })
      ])
      const Shapes = zodTable('shapes', shapeSchema)

      // Insert should be the original schema (no system fields)
      expect(Shapes.schema.insert).toBe(shapeSchema)
    })

    it('provides schema.update for unions (each variant partial)', () => {
      const Shapes = zodTable('shapes', z.union([
        z.object({ kind: z.literal('circle'), r: z.number() }),
        z.object({ kind: z.literal('rect'), w: z.number() })
      ]))

      expect(Shapes.schema.update).toBeInstanceOf(z.ZodUnion)

      // Each variant should be partial
      const result = Shapes.schema.update.parse({ kind: 'circle' })
      expect(result).toEqual({ kind: 'circle' }) // r is now optional
    })
  })

  describe('deprecation warnings', () => {
    let consoleWarnSpy: ReturnType<typeof spyOn>

    beforeEach(() => {
      consoleWarnSpy = spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
      consoleWarnSpy.mockRestore()
    })

    it('warns when accessing zDoc', () => {
      const Users = zodTable('users', { name: z.string() })

      // First access should warn
      const _doc = Users.zDoc
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('zDoc')
      )
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('schema.doc')
      )
    })

    it('warns when accessing docArray', () => {
      const Users = zodTable('users', { name: z.string() })

      const _arr = Users.docArray
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('docArray')
      )
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('schema.docArray')
      )
    })

    it('only warns once per property per table', () => {
      const Users = zodTable('users', { name: z.string() })

      Users.zDoc
      Users.zDoc
      Users.zDoc

      // Should only have warned once for zDoc
      const zDocWarnings = consoleWarnSpy.mock.calls.filter(
        (call: any[]) => call[0]?.includes('zDoc')
      )
      expect(zDocWarnings.length).toBe(1)
    })
  })
})
