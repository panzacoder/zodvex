/**
 * Spike: Convex indexing/querying works with branded paths
 *
 * Goal: Validate that sensitive fields stored as { __sensitiveValue: T } can be:
 * 1. Indexed via defineTable().index('by_email', ['email.__sensitiveValue'])
 * 2. Queried via .withIndex('by_email', q => q.eq('email.__sensitiveValue', value))
 *
 * This is a type-level and structural spike - we can't actually run Convex
 * queries in unit tests, but we can verify the shapes work correctly.
 */

import { describe, expect, it } from 'bun:test'
import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'
import { z } from 'zod'
import { zodToConvex } from '../../src/mapping'

// --- Spike Implementation ---

const SENSITIVE_META_KEY = 'zodvex:sensitive'

function sensitive<T extends z.ZodTypeAny>(inner: T): T {
  return inner.meta({ [SENSITIVE_META_KEY]: { sensitive: true } }) as T
}

/**
 * Convert a Zod schema to Convex validator, wrapping sensitive fields
 * in the branded { __sensitiveValue: T } shape.
 */
function zodToConvexWithSensitive(schema: z.ZodTypeAny): any {
  const defType = (schema as any)._def?.type

  // Handle optionals
  if (defType === 'optional') {
    const inner = (schema as z.ZodOptional<any>).unwrap()
    return v.optional(zodToConvexWithSensitive(inner))
  }

  // Handle nullables
  if (defType === 'nullable') {
    const inner = (schema as z.ZodNullable<any>).unwrap()
    return v.union(zodToConvexWithSensitive(inner), v.null())
  }

  // Check if sensitive
  const meta = schema.meta()
  if (meta?.[SENSITIVE_META_KEY]?.sensitive) {
    const innerValidator = zodToConvex(schema)
    return v.object({ __sensitiveValue: innerValidator })
  }

  // Handle objects recursively
  if (defType === 'object') {
    const shape = (schema as z.ZodObject<any>).shape
    const convexShape: Record<string, any> = {}
    for (const [key, fieldSchema] of Object.entries(shape)) {
      convexShape[key] = zodToConvexWithSensitive(fieldSchema as z.ZodTypeAny)
    }
    return v.object(convexShape)
  }

  // Handle arrays
  if (defType === 'array') {
    return v.array(zodToConvexWithSensitive((schema as z.ZodArray<any>).element))
  }

  // Default: use standard mapping
  return zodToConvex(schema)
}

// --- Tests ---

describe('Spike: Convex indexing with branded sensitive fields', () => {
  describe('Validator shape for indexing', () => {
    it('should create correct nested path structure for sensitive fields', () => {
      const userSchema = z.object({
        name: z.string(),
        email: sensitive(z.string())
      })

      const validator = zodToConvexWithSensitive(userSchema)

      // Verify structure: email should be { __sensitiveValue: string }
      expect(validator.kind).toBe('object')
      expect(validator.fields.name.kind).toBe('string')
      expect(validator.fields.email.kind).toBe('object')
      expect(validator.fields.email.fields.__sensitiveValue.kind).toBe('string')
    })

    it('should support defineTable with sensitive field validator', () => {
      const userValidator = v.object({
        name: v.string(),
        email: v.object({ __sensitiveValue: v.string() }),
        status: v.string()
      })

      // This should not throw - Convex accepts nested object fields
      const table = defineTable(userValidator)

      expect(table).toBeDefined()
    })

    it('should support index definition on nested __sensitiveValue path', () => {
      const userValidator = v.object({
        name: v.string(),
        email: v.object({ __sensitiveValue: v.string() }),
        clinicId: v.string()
      })

      // Define table with index on the nested sensitive value path
      // Convex supports dot-notation paths in index definitions
      const table = defineTable(userValidator)
        .index('by_email', ['email.__sensitiveValue'])
        .index('by_clinic_email', ['clinicId', 'email.__sensitiveValue'])

      expect(table).toBeDefined()
      // The table definition should have the indexes configured
      // (actual index creation happens at schema push time)
    })

    it('should support compound indexes mixing sensitive and regular fields', () => {
      const patientValidator = v.object({
        clinicId: v.string(),
        ssn: v.object({ __sensitiveValue: v.string() }),
        lastName: v.string(),
        createdAt: v.number()
      })

      // Compound index with sensitive field
      const table = defineTable(patientValidator)
        .index('by_clinic_ssn', ['clinicId', 'ssn.__sensitiveValue'])
        .index('by_clinic_name', ['clinicId', 'lastName'])

      expect(table).toBeDefined()
    })
  })

  describe('Schema definition with sensitive fields', () => {
    it('should create valid schema with indexed sensitive fields', () => {
      // This simulates what a real convex/schema.ts would look like
      const schema = defineSchema({
        users: defineTable(
          v.object({
            email: v.object({ __sensitiveValue: v.string() }),
            name: v.string(),
            role: v.string()
          })
        ).index('by_email', ['email.__sensitiveValue']),

        patients: defineTable(
          v.object({
            clinicId: v.id('clinics'),
            ssn: v.object({ __sensitiveValue: v.string() }),
            firstName: v.string(),
            lastName: v.string()
          })
        )
          .index('by_clinic', ['clinicId'])
          .index('by_ssn', ['ssn.__sensitiveValue'])
          .index('by_clinic_ssn', ['clinicId', 'ssn.__sensitiveValue']),

        clinics: defineTable(
          v.object({
            name: v.string()
          })
        )
      })

      expect(schema).toBeDefined()
    })
  })

  describe('Query path validation (structural)', () => {
    it('should validate that branded path structure is query-compatible', () => {
      // When querying, we need to use the full path: 'email.__sensitiveValue'
      // This test verifies the structure we'd use in .withIndex()

      const emailValue = 'test@example.com'

      // The DB stores: { email: { __sensitiveValue: 'test@example.com' } }
      const dbRecord = {
        email: { __sensitiveValue: emailValue },
        name: 'Test User'
      }

      // Query path access simulation
      const queriedValue = dbRecord.email.__sensitiveValue
      expect(queriedValue).toBe(emailValue)

      // This is how the .withIndex query would work:
      // ctx.db.query('users')
      //   .withIndex('by_email', q => q.eq('email.__sensitiveValue', emailValue))
    })

    it('should handle optional sensitive fields in queries', () => {
      // Optional sensitive field in DB
      const dbRecordWithEmail = {
        phone: { __sensitiveValue: '+1234567890' } as { __sensitiveValue: string } | undefined,
        name: 'With Phone'
      }

      const dbRecordWithoutPhone = {
        phone: undefined as { __sensitiveValue: string } | undefined,
        name: 'No Phone'
      }

      // Query simulation - need to handle undefined
      expect(dbRecordWithEmail.phone?.__sensitiveValue).toBe('+1234567890')
      expect(dbRecordWithoutPhone.phone?.__sensitiveValue).toBeUndefined()
    })
  })

  describe('Index path generation helper', () => {
    /**
     * Helper to generate the correct index path for a sensitive field.
     * This would be used when defining indexes programmatically.
     */
    function sensitiveIndexPath(fieldName: string): string {
      return `${fieldName}.__sensitiveValue`
    }

    it('should generate correct index paths', () => {
      expect(sensitiveIndexPath('email')).toBe('email.__sensitiveValue')
      expect(sensitiveIndexPath('ssn')).toBe('ssn.__sensitiveValue')
      expect(sensitiveIndexPath('phone')).toBe('phone.__sensitiveValue')
    })

    it('should work with compound index definitions', () => {
      const clinicId = 'clinicId' // regular field
      const ssn = sensitiveIndexPath('ssn') // sensitive field

      const compoundIndex = [clinicId, ssn]
      expect(compoundIndex).toEqual(['clinicId', 'ssn.__sensitiveValue'])
    })
  })

  describe('Type safety considerations', () => {
    it('should document the type signature for sensitive DB fields', () => {
      // Type definition for sensitive fields in the database
      type SensitiveDb<T> = {
        __sensitiveValue: T
      }

      // Example usage in a document type
      type UserDoc = {
        _id: string
        _creationTime: number
        name: string
        email: SensitiveDb<string>
        phone?: SensitiveDb<string>
      }

      // Type-safe access
      const user: UserDoc = {
        _id: 'user123',
        _creationTime: Date.now(),
        name: 'Test',
        email: { __sensitiveValue: 'test@example.com' }
      }

      // This should type-check correctly
      const emailValue: string = user.email.__sensitiveValue
      expect(emailValue).toBe('test@example.com')

      // Optional field access
      const phoneValue: string | undefined = user.phone?.__sensitiveValue
      expect(phoneValue).toBeUndefined()
    })
  })
})
