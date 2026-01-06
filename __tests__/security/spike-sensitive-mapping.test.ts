/**
 * Spike 1: Test that sensitive(z.*) maps to DB shape v.object({ __sensitiveValue: ... })
 *
 * Goal: Validate that we can:
 * 1. Mark a Zod schema as sensitive using metadata
 * 2. Have zodToConvex produce the branded DB shape
 * 3. Handle .optional(), arrays, nesting, and unions correctly
 */

import { describe, expect, it } from 'bun:test'
import { v } from 'convex/values'
import { z } from 'zod'
import { zodToConvex } from '../../src/mapping'

// --- Spike Implementation ---

// Metadata key for sensitive fields
const SENSITIVE_META_KEY = 'zodvex:sensitive'

interface SensitiveMetadata {
  sensitive: true
  requirements?: unknown
  mask?: (value: unknown) => unknown
}

/**
 * Mark a Zod schema as sensitive.
 * Uses Zod v4's .meta() to attach metadata.
 */
function sensitive<T extends z.ZodTypeAny>(
  inner: T,
  options?: { requirements?: unknown; mask?: (v: z.infer<T>) => z.infer<T> }
): T {
  const meta: SensitiveMetadata = {
    sensitive: true,
    requirements: options?.requirements,
    mask: options?.mask
  }

  // Attach metadata to the schema
  return inner.meta({ [SENSITIVE_META_KEY]: meta }) as T
}

/**
 * Check if a schema has sensitive metadata.
 */
function isSensitive(schema: z.ZodTypeAny): boolean {
  const meta = schema.meta()
  return meta?.[SENSITIVE_META_KEY]?.sensitive === true
}

/**
 * Get sensitive metadata from a schema.
 */
function getSensitiveMeta(schema: z.ZodTypeAny): SensitiveMetadata | undefined {
  const meta = schema.meta()
  return meta?.[SENSITIVE_META_KEY]
}

/**
 * Custom zodToConvex that handles sensitive fields.
 * Wraps sensitive types in { __sensitiveValue: T }
 */
function zodToConvexWithSensitive(schema: z.ZodTypeAny): any {
  const defType = (schema as any)._def?.type

  // Handle optionals FIRST - they wrap the inner type
  // Use def.type check since instanceof can be unreliable across module boundaries
  if (defType === 'optional') {
    const inner = (schema as z.ZodOptional<any>).unwrap()
    const innerResult = zodToConvexWithSensitive(inner)
    // Note: v.optional() sets isOptional: 'optional' on the inner validator,
    // it doesn't change the kind property
    return v.optional(innerResult)
  }

  // Handle nullables
  if (defType === 'nullable') {
    const inner = (schema as z.ZodNullable<any>).unwrap()
    return v.union(zodToConvexWithSensitive(inner), v.null())
  }

  // Check if this schema is marked as sensitive
  if (isSensitive(schema)) {
    // Get the inner Convex validator
    // We need to strip the meta wrapper to get the actual type
    // For now, recreate based on the underlying type
    const innerValidator = zodToConvex(stripMeta(schema))
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

  // Handle unions
  if (defType === 'union') {
    const options = (schema as any)._def.options as z.ZodTypeAny[]
    const convexOptions = options.map((opt) => zodToConvexWithSensitive(opt))
    return v.union(...convexOptions)
  }

  // Handle discriminated unions
  // In Zod v4, discriminatedUnion uses 'options' (array) or 'optionsMap' (Map)
  if (defType === 'discriminatedUnion') {
    const def = (schema as any)._def
    const options = def.options || (def.optionsMap ? Array.from(def.optionsMap.values()) : [])
    const convexOptions = options.map((opt: z.ZodTypeAny) => zodToConvexWithSensitive(opt))
    return v.union(...convexOptions)
  }

  // For everything else, use the standard mapping
  return zodToConvex(schema)
}

/**
 * Strip .meta() from a schema to get the underlying type.
 * Zod v4 doesn't have a direct API for this, so we recreate based on def.type
 */
function stripMeta(schema: z.ZodTypeAny): z.ZodTypeAny {
  const defType = (schema as any)._def?.type

  switch (defType) {
    case 'string':
      return z.string()
    case 'number':
      return z.number()
    case 'boolean':
      return z.boolean()
    case 'date':
      return z.date()
    default:
      // For complex types, this is harder - may need to enhance
      return schema
  }
}

// --- Tests ---

describe('Spike 1: sensitive(z.*) → Convex mapping', () => {
  describe('basic types', () => {
    it('should map sensitive(z.string()) to v.object({ __sensitiveValue: v.string() })', () => {
      const schema = sensitive(z.string())

      expect(isSensitive(schema)).toBe(true)

      const convex = zodToConvexWithSensitive(schema)

      // Check the structure
      expect(convex.kind).toBe('object')
      expect(convex.fields.__sensitiveValue).toBeDefined()
      expect(convex.fields.__sensitiveValue.kind).toBe('string')
    })

    it('should map sensitive(z.number()) correctly', () => {
      const schema = sensitive(z.number())
      const convex = zodToConvexWithSensitive(schema)

      expect(convex.kind).toBe('object')
      expect(convex.fields.__sensitiveValue.kind).toBe('float64')
    })

    it('should map sensitive(z.boolean()) correctly', () => {
      const schema = sensitive(z.boolean())
      const convex = zodToConvexWithSensitive(schema)

      expect(convex.kind).toBe('object')
      expect(convex.fields.__sensitiveValue.kind).toBe('boolean')
    })
  })

  describe('optional sensitive fields', () => {
    it('should map sensitive(z.string()).optional() correctly', () => {
      const schema = sensitive(z.string()).optional()

      const convex = zodToConvexWithSensitive(schema)

      // Convex v.optional() sets isOptional: 'optional' on the inner validator
      // The kind stays 'object' (the sensitive wrapper object)
      expect(convex.isOptional).toBe('optional')
      expect(convex.kind).toBe('object')
      expect(convex.fields.__sensitiveValue.kind).toBe('string')
    })

    it('should map z.object with optional sensitive field', () => {
      const schema = z.object({
        name: z.string(),
        ssn: sensitive(z.string()).optional()
      })
      const convex = zodToConvexWithSensitive(schema)

      expect(convex.kind).toBe('object')
      expect(convex.fields.name.kind).toBe('string')
      // Optional field: isOptional is set on the field validator
      expect(convex.fields.ssn.isOptional).toBe('optional')
      expect(convex.fields.ssn.kind).toBe('object')
      expect(convex.fields.ssn.fields.__sensitiveValue.kind).toBe('string')
    })
  })

  describe('nested objects', () => {
    it('should handle sensitive fields in nested objects', () => {
      const schema = z.object({
        profile: z.object({
          email: sensitive(z.string()),
          phone: z.string()
        })
      })
      const convex = zodToConvexWithSensitive(schema)

      expect(convex.kind).toBe('object')
      expect(convex.fields.profile.kind).toBe('object')
      expect(convex.fields.profile.fields.email.kind).toBe('object')
      expect(convex.fields.profile.fields.email.fields.__sensitiveValue.kind).toBe('string')
      expect(convex.fields.profile.fields.phone.kind).toBe('string')
    })
  })

  describe('arrays of sensitive fields', () => {
    it('should map z.array(sensitive(z.string()))', () => {
      const schema = z.array(sensitive(z.string()))
      const convex = zodToConvexWithSensitive(schema)

      expect(convex.kind).toBe('array')
      expect(convex.element.kind).toBe('object')
      expect(convex.element.fields.__sensitiveValue.kind).toBe('string')
    })
  })

  describe('unions with sensitive fields', () => {
    it('should handle union containing sensitive type', () => {
      const schema = z.union([sensitive(z.string()), z.number()])
      const convex = zodToConvexWithSensitive(schema)

      expect(convex.kind).toBe('union')
      // First member should be the sensitive object
      expect(convex.members[0].kind).toBe('object')
      expect(convex.members[0].fields.__sensitiveValue.kind).toBe('string')
      // Second member should be number
      expect(convex.members[1].kind).toBe('float64')
    })

    it('should handle sensitive fields inside union object variants', () => {
      const schema = z.union([
        z.object({ type: z.literal('user'), email: sensitive(z.string()) }),
        z.object({ type: z.literal('anon'), sessionId: z.string() })
      ])
      const convex = zodToConvexWithSensitive(schema)

      expect(convex.kind).toBe('union')
      // First variant should have sensitive email
      expect(convex.members[0].kind).toBe('object')
      expect(convex.members[0].fields.type.kind).toBe('literal')
      expect(convex.members[0].fields.email.kind).toBe('object')
      expect(convex.members[0].fields.email.fields.__sensitiveValue.kind).toBe('string')
      // Second variant should be plain
      expect(convex.members[1].fields.type.kind).toBe('literal')
      expect(convex.members[1].fields.sessionId.kind).toBe('string')
    })
  })

  describe('discriminated unions with sensitive fields', () => {
    it('should handle z.discriminatedUnion with sensitive fields in variants', () => {
      const schema = z.discriminatedUnion('kind', [
        z.object({
          kind: z.literal('patient'),
          name: z.string(),
          ssn: sensitive(z.string())
        }),
        z.object({
          kind: z.literal('provider'),
          name: z.string(),
          npi: sensitive(z.string())
        })
      ])
      const convex = zodToConvexWithSensitive(schema)

      expect(convex.kind).toBe('union')
      expect(convex.members).toHaveLength(2)

      // Patient variant
      const patient = convex.members[0]
      expect(patient.kind).toBe('object')
      expect(patient.fields.kind.kind).toBe('literal')
      expect(patient.fields.kind.value).toBe('patient')
      expect(patient.fields.name.kind).toBe('string')
      expect(patient.fields.ssn.kind).toBe('object')
      expect(patient.fields.ssn.fields.__sensitiveValue.kind).toBe('string')

      // Provider variant
      const provider = convex.members[1]
      expect(provider.kind).toBe('object')
      expect(provider.fields.kind.kind).toBe('literal')
      expect(provider.fields.kind.value).toBe('provider')
      expect(provider.fields.name.kind).toBe('string')
      expect(provider.fields.npi.kind).toBe('object')
      expect(provider.fields.npi.fields.__sensitiveValue.kind).toBe('string')
    })

    it('should handle discriminated union with multiple sensitive fields per variant', () => {
      const schema = z.discriminatedUnion('type', [
        z.object({
          type: z.literal('contact'),
          email: sensitive(z.string()),
          phone: sensitive(z.string()),
          publicNotes: z.string()
        }),
        z.object({
          type: z.literal('address'),
          street: sensitive(z.string()),
          city: z.string(),
          zip: z.string()
        })
      ])
      const convex = zodToConvexWithSensitive(schema)

      expect(convex.kind).toBe('union')

      // Contact variant - two sensitive fields
      const contact = convex.members[0]
      expect(contact.fields.email.kind).toBe('object')
      expect(contact.fields.email.fields.__sensitiveValue.kind).toBe('string')
      expect(contact.fields.phone.kind).toBe('object')
      expect(contact.fields.phone.fields.__sensitiveValue.kind).toBe('string')
      expect(contact.fields.publicNotes.kind).toBe('string')

      // Address variant - one sensitive field
      const address = convex.members[1]
      expect(address.fields.street.kind).toBe('object')
      expect(address.fields.street.fields.__sensitiveValue.kind).toBe('string')
      expect(address.fields.city.kind).toBe('string')
      expect(address.fields.zip.kind).toBe('string')
    })

    it('should handle nested discriminated unions with sensitive fields', () => {
      const innerDU = z.discriminatedUnion('contactType', [
        z.object({ contactType: z.literal('email'), value: sensitive(z.string()) }),
        z.object({ contactType: z.literal('phone'), value: sensitive(z.string()) })
      ])

      const schema = z.discriminatedUnion('kind', [
        z.object({
          kind: z.literal('person'),
          name: z.string(),
          contact: innerDU
        }),
        z.object({
          kind: z.literal('org'),
          orgName: z.string()
        })
      ])
      const convex = zodToConvexWithSensitive(schema)

      expect(convex.kind).toBe('union')

      // Person variant has nested DU
      const person = convex.members[0]
      expect(person.fields.contact.kind).toBe('union')
      expect(person.fields.contact.members[0].fields.value.kind).toBe('object')
      expect(person.fields.contact.members[0].fields.value.fields.__sensitiveValue.kind).toBe(
        'string'
      )
    })

    it('should handle optional sensitive fields in discriminated union variants', () => {
      const schema = z.discriminatedUnion('role', [
        z.object({
          role: z.literal('admin'),
          email: sensitive(z.string()),
          backupEmail: sensitive(z.string()).optional()
        }),
        z.object({
          role: z.literal('guest'),
          tempId: z.string()
        })
      ])
      const convex = zodToConvexWithSensitive(schema)

      const admin = convex.members[0]
      expect(admin.fields.email.kind).toBe('object')
      expect(admin.fields.email.isOptional).toBe('required')
      expect(admin.fields.backupEmail.kind).toBe('object')
      expect(admin.fields.backupEmail.isOptional).toBe('optional')
      expect(admin.fields.backupEmail.fields.__sensitiveValue.kind).toBe('string')
    })
  })

  describe('metadata preservation', () => {
    it('should preserve requirements metadata', () => {
      const schema = sensitive(z.string(), { requirements: 'admin' })
      const meta = getSensitiveMeta(schema)

      expect(meta).toBeDefined()
      expect(meta?.sensitive).toBe(true)
      expect(meta?.requirements).toBe('admin')
    })

    it('should preserve mask function', () => {
      const maskFn = (v: string) => v.replace(/./g, '*')
      const schema = sensitive(z.string(), { mask: maskFn })
      const meta = getSensitiveMeta(schema)

      expect(meta?.mask).toBe(maskFn)
    })
  })
})
