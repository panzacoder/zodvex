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
})
