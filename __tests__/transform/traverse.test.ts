/**
 * Tests for src/transform/traverse.ts
 *
 * TDD: Write tests first, then implement to make them pass.
 *
 * Tests schema traversal utilities: getMetadata, hasMetadata, walkSchema, findFieldsWithMeta
 */

import { describe, expect, it, mock } from 'bun:test'
import { z } from 'zod'
import {
  getMetadata,
  hasMetadata,
  walkSchema,
  findFieldsWithMeta
} from '../../src/transform/traverse'
import type { FieldInfo } from '../../src/transform/types'

describe('transform/traverse.ts', () => {
  describe('getMetadata', () => {
    it('should return metadata from schema.meta()', () => {
      const schema = z.string().meta({ foo: 'bar', count: 42 })
      const meta = getMetadata(schema)

      expect(meta).toEqual({ foo: 'bar', count: 42 })
    })

    it('should return undefined for schemas without metadata', () => {
      const schema = z.string()
      const meta = getMetadata(schema)

      expect(meta).toBeUndefined()
    })

    it('should return empty object or undefined for empty meta', () => {
      const schema = z.string().meta({})
      const meta = getMetadata(schema)

      // Zod may return undefined or empty object - both are acceptable
      if (meta !== undefined) {
        expect(meta).toEqual({})
      } else {
        expect(meta).toBeUndefined()
      }
    })
  })

  describe('hasMetadata', () => {
    it('should return true when predicate matches', () => {
      const schema = z.string().meta({ sensitive: true })
      const result = hasMetadata(schema, meta => meta.sensitive === true)

      expect(result).toBe(true)
    })

    it('should return false when predicate does not match', () => {
      const schema = z.string().meta({ sensitive: false })
      const result = hasMetadata(schema, meta => meta.sensitive === true)

      expect(result).toBe(false)
    })

    it('should return false when no metadata', () => {
      const schema = z.string()
      const result = hasMetadata(schema, meta => meta.sensitive === true)

      expect(result).toBe(false)
    })
  })

  describe('walkSchema', () => {
    it('should visit object fields', () => {
      const schema = z.object({
        name: z.string(),
        age: z.number()
      })
      const visited: string[] = []

      walkSchema(schema, {
        onField: info => {
          visited.push(info.path)
        }
      })

      expect(visited).toContain('')
      expect(visited).toContain('name')
      expect(visited).toContain('age')
    })

    it('should visit nested objects', () => {
      const schema = z.object({
        user: z.object({
          profile: z.object({
            email: z.string()
          })
        })
      })
      const visited: string[] = []

      walkSchema(schema, {
        onField: info => {
          visited.push(info.path)
        }
      })

      expect(visited).toContain('user')
      expect(visited).toContain('user.profile')
      expect(visited).toContain('user.profile.email')
    })

    it('should visit array elements with [] notation', () => {
      const schema = z.object({
        contacts: z.array(
          z.object({
            email: z.string()
          })
        )
      })
      const visited: string[] = []

      walkSchema(schema, {
        onField: info => {
          visited.push(info.path)
        }
      })

      expect(visited).toContain('contacts')
      expect(visited).toContain('contacts[]')
      expect(visited).toContain('contacts[].email')
    })

    it('should unwrap optionals and track isOptional', () => {
      const schema = z.object({
        required: z.string(),
        optional: z.string().optional()
      })
      const optionalFields: string[] = []

      walkSchema(schema, {
        onField: info => {
          if (info.isOptional && info.path) {
            optionalFields.push(info.path)
          }
        }
      })

      expect(optionalFields).toContain('optional')
      expect(optionalFields).not.toContain('required')
    })

    it('should unwrap nullables', () => {
      const schema = z.object({
        nullable: z.string().nullable()
      })
      const visited: string[] = []

      walkSchema(schema, {
        onField: info => {
          visited.push(info.path)
        }
      })

      // Should visit both the nullable wrapper and the inner string
      expect(visited).toContain('nullable')
    })

    it('should visit all union variants', () => {
      const schema = z.union([
        z.object({ type: z.literal('a'), valueA: z.string() }),
        z.object({ type: z.literal('b'), valueB: z.number() })
      ])
      const visited: string[] = []

      walkSchema(schema, {
        onField: info => {
          visited.push(info.path)
        }
      })

      // Should visit fields from both variants
      expect(visited).toContain('type')
      expect(visited).toContain('valueA')
      expect(visited).toContain('valueB')
    })

    it('should visit discriminated union variants', () => {
      const schema = z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('cat'), meow: z.boolean() }),
        z.object({ kind: z.literal('dog'), bark: z.boolean() })
      ])
      const visited: string[] = []

      walkSchema(schema, {
        onField: info => {
          visited.push(info.path)
        }
      })

      // Should visit fields from both variants
      expect(visited).toContain('kind')
      expect(visited).toContain('meow')
      expect(visited).toContain('bark')
    })

    it('should call onUnion with variants', () => {
      const variantA = z.object({ type: z.literal('a') })
      const variantB = z.object({ type: z.literal('b') })
      const schema = z.union([variantA, variantB])
      let capturedVariants: z.ZodTypeAny[] = []

      walkSchema(schema, {
        onUnion: (_info, variants) => {
          capturedVariants = variants
        }
      })

      expect(capturedVariants.length).toBe(2)
    })

    it('should call onObject when entering objects', () => {
      const schema = z.object({
        nested: z.object({
          value: z.string()
        })
      })
      const objectPaths: string[] = []

      walkSchema(schema, {
        onObject: info => {
          objectPaths.push(info.path)
        }
      })

      expect(objectPaths).toContain('')
      expect(objectPaths).toContain('nested')
    })

    it('should call onArray when entering arrays', () => {
      const schema = z.object({
        items: z.array(z.string())
      })
      const arrayPaths: string[] = []

      walkSchema(schema, {
        onArray: info => {
          arrayPaths.push(info.path)
        }
      })

      expect(arrayPaths).toContain('items')
    })

    it('should stop when onField returns "skip"', () => {
      const schema = z.object({
        shallow: z.object({
          deep: z.string()
        })
      })
      const visited: string[] = []

      walkSchema(schema, {
        onField: info => {
          visited.push(info.path)
          if (info.path === 'shallow') {
            return 'skip'
          }
        }
      })

      expect(visited).toContain('shallow')
      expect(visited).not.toContain('shallow.deep')
    })

    it('should use path option as prefix', () => {
      const schema = z.object({
        field: z.string()
      })
      const visited: string[] = []

      walkSchema(
        schema,
        {
          onField: info => {
            visited.push(info.path)
          }
        },
        { path: 'prefix' }
      )

      expect(visited).toContain('prefix')
      expect(visited).toContain('prefix.field')
    })

    it('should include metadata in FieldInfo', () => {
      const schema = z.object({
        marked: z.string().meta({ special: true }),
        unmarked: z.string()
      })
      const fieldsWithMeta: FieldInfo[] = []

      walkSchema(schema, {
        onField: info => {
          if (info.meta) {
            fieldsWithMeta.push(info)
          }
        }
      })

      expect(fieldsWithMeta.length).toBe(1)
      expect(fieldsWithMeta[0].path).toBe('marked')
      expect(fieldsWithMeta[0].meta).toEqual({ special: true })
    })

    it('should prevent infinite recursion on circular refs', () => {
      // Create a schema that references itself through a lazy wrapper
      // Note: Pure circular refs are hard to create in Zod, so we test
      // that the same schema instance isn't visited twice
      const innerSchema = z.string()
      const schema = z.object({
        a: innerSchema,
        b: innerSchema // Same schema instance
      })
      const visitCount = new Map<string, number>()

      walkSchema(schema, {
        onField: info => {
          const count = visitCount.get(info.path) ?? 0
          visitCount.set(info.path, count + 1)
        }
      })

      // Each path should be visited only once
      for (const [path, count] of visitCount) {
        expect(count).toBe(1)
      }
    })
  })

  describe('findFieldsWithMeta', () => {
    it('should find fields with matching metadata', () => {
      const schema = z.object({
        name: z.string(),
        email: z.string().meta({ sensitive: true }),
        phone: z.string().meta({ sensitive: true })
      })

      const results = findFieldsWithMeta(schema, meta => meta?.sensitive === true)

      expect(results.length).toBe(2)
      expect(results.map(r => r.path)).toContain('email')
      expect(results.map(r => r.path)).toContain('phone')
    })

    it('should return empty array when no matches', () => {
      const schema = z.object({
        name: z.string(),
        age: z.number()
      })

      const results = findFieldsWithMeta(schema, meta => meta?.sensitive === true)

      expect(results).toEqual([])
    })

    it('should find nested sensitive fields', () => {
      const schema = z.object({
        user: z.object({
          profile: z.object({
            email: z.string().meta({ sensitive: true })
          })
        })
      })

      const results = findFieldsWithMeta(schema, meta => meta?.sensitive === true)

      expect(results.length).toBe(1)
      expect(results[0].path).toBe('user.profile.email')
    })

    it('should find fields in arrays', () => {
      const schema = z.object({
        contacts: z.array(
          z.object({
            email: z.string().meta({ sensitive: true })
          })
        )
      })

      const results = findFieldsWithMeta(schema, meta => meta?.sensitive === true)

      expect(results.length).toBe(1)
      expect(results[0].path).toBe('contacts[].email')
    })

    it('should find fields in union variants', () => {
      const schema = z.union([
        z.object({ type: z.literal('person'), ssn: z.string().meta({ sensitive: true }) }),
        z.object({ type: z.literal('company'), ein: z.string().meta({ sensitive: true }) })
      ])

      const results = findFieldsWithMeta(schema, meta => meta?.sensitive === true)

      expect(results.length).toBe(2)
      expect(results.map(r => r.path)).toContain('ssn')
      expect(results.map(r => r.path)).toContain('ein')
    })

    it('should not recurse into matching fields', () => {
      // If a schema has metadata matching the predicate, we shouldn't look inside it
      const schema = z.object({
        wrapper: z
          .object({
            inner: z.string().meta({ sensitive: true })
          })
          .meta({ sensitive: true })
      })

      const results = findFieldsWithMeta(schema, meta => meta?.sensitive === true)

      // Should find wrapper but not inner (because we stopped at wrapper)
      expect(results.length).toBe(1)
      expect(results[0].path).toBe('wrapper')
    })

    it('should work with type guard predicate', () => {
      type SensitiveMeta = { sensitive: true; level: string }

      const isSensitiveMeta = (meta: Record<string, unknown> | undefined): meta is SensitiveMeta =>
        meta?.sensitive === true && typeof meta?.level === 'string'

      const schema = z.object({
        email: z.string().meta({ sensitive: true, level: 'pii' }),
        name: z.string().meta({ sensitive: true }) // Missing level - shouldn't match
      })

      const results = findFieldsWithMeta(schema, isSensitiveMeta)

      expect(results.length).toBe(1)
      expect(results[0].path).toBe('email')
      expect(results[0].meta.level).toBe('pii')
    })

    it('should find fields in optional wrappers', () => {
      const schema = z.object({
        optionalEmail: z.string().meta({ sensitive: true }).optional()
      })

      const results = findFieldsWithMeta(schema, meta => meta?.sensitive === true)

      expect(results.length).toBe(1)
      expect(results[0].path).toBe('optionalEmail')
    })
  })

  describe('z.lazy() handling', () => {
    it('should traverse z.lazy() schemas', () => {
      // Simple lazy wrapper (non-recursive)
      const lazySchema = z.lazy(() =>
        z.object({
          name: z.string().meta({ sensitive: true })
        })
      )
      const visited: string[] = []

      walkSchema(lazySchema, {
        onField: info => {
          visited.push(info.path)
        }
      })

      expect(visited).toContain('name')
    })

    it('should handle recursive schemas without infinite loop', () => {
      // Recursive schema - Person with friends array of Person
      type Person = { name: string; friends: Person[] }
      const personSchema: z.ZodType<Person> = z.lazy(() =>
        z.object({
          name: z.string(),
          friends: z.array(personSchema)
        })
      )
      const visited: string[] = []
      let callCount = 0

      walkSchema(personSchema, {
        onField: info => {
          callCount++
          visited.push(info.path)
          // Safety limit to ensure we don't infinite loop
          if (callCount > 100) {
            throw new Error('Infinite loop detected!')
          }
        }
      })

      // Should visit the fields without infinite loop
      // Note: The recursive reference (personSchema in friends array) is the same
      // schema instance, so the visited Set correctly prevents infinite recursion
      expect(visited).toContain('name')
      expect(visited).toContain('friends')
      // The recursive reference stops at 'friends' because personSchema was already visited
      expect(callCount).toBeLessThan(20)
    })

    it('should find metadata in lazy schemas', () => {
      const lazySchema = z.lazy(() =>
        z.object({
          email: z.string().meta({ sensitive: true }),
          name: z.string()
        })
      )

      const results = findFieldsWithMeta(lazySchema, meta => meta?.sensitive === true)

      expect(results.length).toBe(1)
      expect(results[0].path).toBe('email')
    })

    it('should handle deeply nested lazy schemas', () => {
      const innerLazy = z.lazy(() => z.object({ value: z.string().meta({ marked: true }) }))
      const outerLazy = z.lazy(() => z.object({ inner: innerLazy }))
      const visited: string[] = []

      walkSchema(outerLazy, {
        onField: info => {
          visited.push(info.path)
        }
      })

      expect(visited).toContain('inner')
      expect(visited).toContain('inner.value')
    })
  })
})
