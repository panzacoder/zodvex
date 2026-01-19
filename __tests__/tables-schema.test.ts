import { describe, expect, it } from 'bun:test'
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
})
