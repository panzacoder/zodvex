import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { registryHelpers, zid } from '../src/ids'

/**
 * Compatibility tests for motiion project's usage of zid
 *
 * The motiion project uses:
 * 1. getSchemaDefaults() - accesses _def to extract default values
 * 2. detectConvexId() - checks _tableName property and registry metadata
 * 3. convexSchemaToForm() - detects field types including Convex IDs
 */

describe('zid - motiion compatibility', () => {
  describe('getSchemaDefaults compatibility', () => {
    // Simulate motiion's getSchemaDefaults behavior
    function getDefaults(schema: z.ZodTypeAny): any {
      const def = (schema as any)._def
      if (!def) return undefined

      const type = def.type

      // motiion checks for 'branded' type - we no longer have this
      if (type === 'branded') {
        const innerType = def.type
        return innerType ? getDefaults(innerType) : undefined
      }

      // motiion checks for 'effects' - we don't hit this with new zid
      if (type === 'effects' || type === 'transformer') {
        const innerSchema = def.schema || def.effect?.schema
        return innerSchema ? getDefaults(innerSchema) : undefined
      }

      // Base types - NEW ZID HITS HERE DIRECTLY as 'string'
      if (type === 'string') return ''
      if (type === 'number') return 0
      if (type === 'boolean') return false
      if (type === 'optional') return undefined
      if (type === 'object') {
        const shape = def.shape || {}
        const defaults: Record<string, any> = {}
        for (const key in shape) {
          defaults[key] = getDefaults(shape[key])
        }
        return defaults
      }

      return undefined
    }

    it('extracts defaults from schemas with zid fields', () => {
      const schema = z.object({
        userId: zid('users'),
        name: z.string(),
        age: z.number()
      })

      const defaults = getDefaults(schema)

      // zid should resolve to empty string (since inner type is string)
      expect(defaults).toEqual({
        userId: '',
        name: '',
        age: 0
      })
    })

    it('handles optional zid fields correctly', () => {
      const schema = z.object({
        agencyId: z.optional(zid('agencies')),
        name: z.string()
      })

      const defaults = getDefaults(schema)

      // Optional wrapper returns undefined
      expect(defaults).toEqual({
        agencyId: undefined,
        name: ''
      })
    })

    it('handles nested objects with zid fields', () => {
      const representationSchema = z.object({
        representation: z.optional(z
                    .object({
                      agencyId: z.optional(zid('agencies')),
                      displayRep: z.optional(z.boolean())
                    }))
      })

      const defaults = getDefaults(representationSchema)

      // Outer optional returns undefined, never processes inner zid
      expect(defaults).toEqual({
        representation: undefined
      })
    })
  })

  describe('type name detection (for convexSchemaToForm)', () => {
    function getTypeName(schema: z.ZodTypeAny): string | undefined {
      return (schema as any)?._def?.type
    }

    it('has type name of "string" instead of "branded"', () => {
      const userId = zid('users')
      const typeName = getTypeName(userId)

      // Old zid: 'branded'
      // New zid: 'string' (with .refine() but type stays 'string')
      expect(typeName).toBe('string')
    })

    it('can still be detected via _tableName and registry despite being a plain string', () => {
      const userId = zid('users')

      // Even though type is just 'string' (not 'branded'), detectConvexId will find it via:
      // 1. _tableName property check (checked FIRST in motiion)
      // 2. Registry metadata check (fallback in motiion)

      const typeName = getTypeName(userId)
      expect(typeName).toBe('string') // Not 'branded' anymore

      // But detection still works via the two properties motiion checks
      expect((userId as any)._tableName).toBe('users')
      expect(registryHelpers.getMetadata(userId).isConvexId).toBe(true)
    })
  })

  describe('real-world usage patterns from motiion', () => {
    it('works in union types (profileId pattern)', () => {
      const profileIdUnion = z.union([zid('dancers'), zid('choreographers')])

      const dancerVariant = profileIdUnion.options[0]
      const choreoVariant = profileIdUnion.options[1]

      // Both variants should be detectable
      expect((dancerVariant as any)._tableName).toBe('dancers')
      expect((choreoVariant as any)._tableName).toBe('choreographers')
    })

    it('works in arrays (favoriteChoreographers pattern)', () => {
      const favoritesSchema = z.array(zid('choreographers'))

      // The element type should be detectable
      const elementType = (favoritesSchema as any)._def.type
      expect(elementType).toBe('array')

      // The inner schema (via _def.element) should have _tableName
      const innerSchema = (favoritesSchema as any)._def.element
      expect((innerSchema as any)._tableName).toBe('choreographers')
    })

    it('works with optional wrapper (agencyId pattern)', () => {
      const agencyIdOptional = z.optional(zid('agencies'))

      // Optional wrapper should preserve access to inner schema
      const innerSchema = (agencyIdOptional as any)._def.innerType
      expect((innerSchema as any)._tableName).toBe('agencies')

      // Registry check should work on the optional too
      const meta = registryHelpers.getMetadata(innerSchema)
      expect(meta?.isConvexId).toBe(true)
      expect(meta?.tableName).toBe('agencies')
    })

    it('works in storage union pattern (media field)', () => {
      const mediaSchema = z.union([zid('_storage'), z.string()])

      const storageVariant = mediaSchema.options[0]
      expect((storageVariant as any)._tableName).toBe('_storage')
    })
  })
})
