/**
 * Tests for src/transform/transform.ts
 *
 * TDD: Write tests first, then implement to make them pass.
 *
 * Tests value transformation utilities: transformBySchema, transformBySchemaAsync
 */

import { describe, expect, it, mock } from 'bun:test'
import { z } from 'zod'
import { transformBySchema, transformBySchemaAsync } from '../../src/transform/transform'
import { getMetadata } from '../../src/transform/traverse'
import type { TransformContext } from '../../src/transform/types'

describe('transform/transform.ts', () => {
  describe('transformBySchema', () => {
    it('should transform matching fields', () => {
      const schema = z.object({
        name: z.string(),
        secret: z.string().meta({ sensitive: true })
      })
      const value = { name: 'John', secret: 'password123' }

      const result = transformBySchema(value, schema, null, (val, ctx) => {
        if (ctx.meta?.sensitive === true) {
          return '[REDACTED]'
        }
        return val
      })

      expect(result.name).toBe('John')
      expect(result.secret).toBe('[REDACTED]')
    })

    it('should preserve non-matching fields', () => {
      const schema = z.object({
        name: z.string(),
        age: z.number()
      })
      const value = { name: 'John', age: 30 }

      const result = transformBySchema(value, schema, null, val => val)

      expect(result).toEqual({ name: 'John', age: 30 })
    })

    it('should handle nested objects', () => {
      const schema = z.object({
        user: z.object({
          profile: z.object({
            email: z.string().meta({ sensitive: true })
          })
        })
      })
      const value = { user: { profile: { email: 'john@example.com' } } }

      const result = transformBySchema(value, schema, null, (val, ctx) => {
        if (ctx.meta?.sensitive === true) {
          return '[HIDDEN]'
        }
        return val
      })

      expect(result.user.profile.email).toBe('[HIDDEN]')
    })

    it('should handle arrays with indexed paths', () => {
      const schema = z.object({
        items: z.array(z.string().meta({ sensitive: true }))
      })
      const value = { items: ['a', 'b', 'c'] }
      const paths: string[] = []

      transformBySchema(value, schema, null, (val, ctx) => {
        paths.push(ctx.path)
        if (ctx.meta?.sensitive === true) {
          return `[${val}]`
        }
        return val
      })

      expect(paths).toContain('items[0]')
      expect(paths).toContain('items[1]')
      expect(paths).toContain('items[2]')
    })

    it('should handle null values', () => {
      const schema = z.object({
        name: z.string().nullable()
      })
      const value = { name: null }

      const result = transformBySchema(value, schema, null, val => {
        if (val === null) {
          return 'was null'
        }
        return val
      })

      // null is preserved at root level
      expect(result.name).toBeNull()
    })

    it('should handle undefined values', () => {
      const schema = z.object({
        name: z.string().optional()
      })
      const value = { name: undefined }

      const result = transformBySchema(value, schema, null, val => {
        if (val === undefined) {
          return 'was undefined'
        }
        return val
      })

      // undefined is preserved
      expect(result.name).toBeUndefined()
    })

    it('should handle optional fields that are present', () => {
      const schema = z.object({
        email: z.string().meta({ sensitive: true }).optional()
      })
      const value = { email: 'john@example.com' }

      const result = transformBySchema(value, schema, null, (val, ctx) => {
        if (ctx.meta?.sensitive === true) {
          return '[REDACTED]'
        }
        return val
      })

      expect(result.email).toBe('[REDACTED]')
    })

    it('should pass context through', () => {
      type Ctx = { userId: string }
      const schema = z.object({
        data: z.string().meta({ owned: true })
      })
      const value = { data: 'secret' }
      const ctx: Ctx = { userId: 'user123' }

      let capturedCtx: Ctx | null = null
      transformBySchema(value, schema, ctx, (val, context) => {
        if (context.meta?.owned) {
          capturedCtx = context.ctx as Ctx
        }
        return val
      })

      expect(capturedCtx?.userId).toBe('user123')
    })

    it('should use path option as prefix', () => {
      const schema = z.object({
        field: z.string().meta({ mark: true })
      })
      const value = { field: 'value' }
      let capturedPath = ''

      transformBySchema(
        value,
        schema,
        null,
        (val, ctx) => {
          if (ctx.meta?.mark) {
            capturedPath = ctx.path
          }
          return val
        },
        { path: 'root' }
      )

      expect(capturedPath).toBe('root.field')
    })

    it('should see metadata through wrapper/effect types (Option 1)', () => {
      const schema = z.object({
        // Meta is on the inner string, but the schema node is wrapped.
        secret: z
          .string()
          .meta({ sensitive: true })
          .transform(v => v)
      })
      const value = { secret: 'password123' }

      const result = transformBySchema(value, schema, null, (val, ctx) => {
        if (ctx.meta?.sensitive === true) {
          return '[REDACTED]'
        }
        return val
      })

      expect(result.secret).toBe('[REDACTED]')
    })
  })

  describe('transformBySchemaAsync', () => {
    it('should support async transform functions', async () => {
      const schema = z.object({
        secret: z.string().meta({ sensitive: true })
      })
      const value = { secret: 'password' }

      const result = await transformBySchemaAsync(value, schema, null, async (val, ctx) => {
        if (ctx.meta?.sensitive === true) {
          // Simulate async operation
          await new Promise(resolve => setTimeout(resolve, 1))
          return '[ASYNC_REDACTED]'
        }
        return val
      })

      expect(result.secret).toBe('[ASYNC_REDACTED]')
    })

    it('should await each field transformation', async () => {
      const schema = z.object({
        a: z.string().meta({ order: 1 }),
        b: z.string().meta({ order: 2 })
      })
      const value = { a: 'first', b: 'second' }
      const order: number[] = []

      await transformBySchemaAsync(value, schema, null, async (val, ctx) => {
        if (ctx.meta?.order) {
          await new Promise(resolve => setTimeout(resolve, 1))
          order.push(ctx.meta.order as number)
        }
        return val
      })

      // Fields should be processed in order
      expect(order).toEqual([1, 2])
    })

    it('should handle nested async transforms', async () => {
      const schema = z.object({
        user: z.object({
          email: z.string().meta({ encrypt: true })
        })
      })
      const value = { user: { email: 'test@example.com' } }

      const result = await transformBySchemaAsync(value, schema, null, async (val, ctx) => {
        if (ctx.meta?.encrypt === true) {
          await new Promise(resolve => setTimeout(resolve, 1))
          return `encrypted:${val}`
        }
        return val
      })

      expect(result.user.email).toBe('encrypted:test@example.com')
    })
  })

  describe('union handling', () => {
    describe('discriminated unions', () => {
      it('should transform matching discriminated union variant', () => {
        const schema = z.discriminatedUnion('type', [
          z.object({ type: z.literal('dog'), bark: z.string().meta({ sensitive: true }) }),
          z.object({ type: z.literal('cat'), meow: z.string().meta({ sensitive: true }) })
        ])
        const dogValue = { type: 'dog' as const, bark: 'woof' }
        const catValue = { type: 'cat' as const, meow: 'purr' }

        const dogResult = transformBySchema(dogValue, schema, null, (val, ctx) => {
          if (ctx.meta?.sensitive === true) {
            return '[REDACTED]'
          }
          return val
        })

        const catResult = transformBySchema(catValue, schema, null, (val, ctx) => {
          if (ctx.meta?.sensitive === true) {
            return '[REDACTED]'
          }
          return val
        })

        expect(dogResult.bark).toBe('[REDACTED]')
        expect(catResult.meow).toBe('[REDACTED]')
      })

      it('should return null with unmatchedUnion: "null"', () => {
        const schema = z.discriminatedUnion('type', [
          z.object({ type: z.literal('a'), value: z.string() }),
          z.object({ type: z.literal('b'), value: z.string() })
        ])
        const invalidValue = { type: 'invalid', value: 'test' }

        const result = transformBySchema(invalidValue, schema, null, val => val, {
          unmatchedUnion: 'null'
        })

        expect(result).toBeNull()
      })

      it('should throw with unmatchedUnion: "error"', () => {
        const schema = z.discriminatedUnion('type', [
          z.object({ type: z.literal('a'), value: z.string() }),
          z.object({ type: z.literal('b'), value: z.string() })
        ])
        const invalidValue = { type: 'invalid', value: 'test' }

        expect(() => {
          transformBySchema(invalidValue, schema, null, val => val, {
            unmatchedUnion: 'error'
          })
        }).toThrow('No union variant matched')
      })

      it('should pass through with unmatchedUnion: "passthrough" (default)', () => {
        const schema = z.discriminatedUnion('type', [
          z.object({ type: z.literal('a'), value: z.string() }),
          z.object({ type: z.literal('b'), value: z.string() })
        ])
        const invalidValue = { type: 'invalid', value: 'test' }

        const result = transformBySchema(invalidValue, schema, null, val => val)

        expect(result).toEqual(invalidValue)
      })

      it('should call onUnmatchedUnion callback', () => {
        const schema = z.discriminatedUnion('type', [
          z.object({ type: z.literal('a'), value: z.string() })
        ])
        const invalidValue = { type: 'invalid', value: 'test' }
        const callback = mock(() => {
          // intentionally empty - just tracking calls
        })

        transformBySchema(invalidValue, schema, null, val => val, {
          onUnmatchedUnion: callback
        })

        expect(callback).toHaveBeenCalledWith('')
      })
    })

    describe('regular unions', () => {
      it('should try each variant for regular unions', () => {
        const schema = z.union([
          z.object({ kind: z.literal('a'), data: z.string().meta({ mark: true }) }),
          z.object({ kind: z.literal('b'), data: z.number() })
        ])
        const value = { kind: 'a' as const, data: 'test' }

        const result = transformBySchema(value, schema, null, (val, ctx) => {
          if (ctx.meta?.mark === true) {
            return '[MARKED]'
          }
          return val
        })

        expect(result.data).toBe('[MARKED]')
      })
    })

    describe('async union handling', () => {
      it('should handle async transforms in discriminated unions', async () => {
        const schema = z.discriminatedUnion('type', [
          z.object({ type: z.literal('a'), secret: z.string().meta({ sensitive: true }) })
        ])
        const value = { type: 'a' as const, secret: 'password' }

        const result = await transformBySchemaAsync(value, schema, null, async (val, ctx) => {
          if (ctx.meta?.sensitive === true) {
            await new Promise(resolve => setTimeout(resolve, 1))
            return '[ASYNC]'
          }
          return val
        })

        expect(result.secret).toBe('[ASYNC]')
      })

      it('should return null for unmatched async discriminated union with null option', async () => {
        const schema = z.discriminatedUnion('type', [
          z.object({ type: z.literal('a'), value: z.string() })
        ])
        const invalidValue = { type: 'invalid', value: 'test' }

        const result = await transformBySchemaAsync(invalidValue, schema, null, async val => val, {
          unmatchedUnion: 'null'
        })

        expect(result).toBeNull()
      })
    })
  })

  describe('shouldTransform predicate', () => {
    it('should skip transform callback when predicate returns false', () => {
      const schema = z.object({
        name: z.string(),
        secret: z.string().meta({ sensitive: true })
      })
      const value = { name: 'John', secret: 'password123' }
      const callCount = { total: 0, sensitive: 0 }

      const result = transformBySchema(
        value,
        schema,
        null,
        (val, ctx) => {
          callCount.total++
          if (ctx.meta?.sensitive === true) {
            callCount.sensitive++
            return '[REDACTED]'
          }
          return val
        },
        {
          // Only call transform for schemas with sensitive metadata
          shouldTransform: sch => getMetadata(sch)?.sensitive === true
        }
      )

      expect(result.name).toBe('John') // Unchanged (callback never called)
      expect(result.secret).toBe('[REDACTED]') // Transformed
      expect(callCount.sensitive).toBe(1) // Called once for secret
      // Should only call transform for sensitive fields, not all fields
      expect(callCount.total).toBe(1)
    })

    it('should still recurse into children when predicate returns false', () => {
      const schema = z.object({
        user: z.object({
          profile: z.object({
            email: z.string().meta({ sensitive: true })
          })
        })
      })
      const value = { user: { profile: { email: 'test@example.com' } } }

      const result = transformBySchema(
        value,
        schema,
        null,
        (val, ctx) => {
          if (ctx.meta?.sensitive === true) {
            return '[HIDDEN]'
          }
          return val
        },
        {
          shouldTransform: sch => getMetadata(sch)?.sensitive === true
        }
      )

      // Should still find and transform the deeply nested sensitive field
      expect(result.user.profile.email).toBe('[HIDDEN]')
    })

    it('should work with arrays', () => {
      const schema = z.object({
        items: z.array(
          z.object({
            public: z.string(),
            secret: z.string().meta({ sensitive: true })
          })
        )
      })
      const value = {
        items: [
          { public: 'a', secret: 'x' },
          { public: 'b', secret: 'y' }
        ]
      }
      let callCount = 0

      const result = transformBySchema(
        value,
        schema,
        null,
        (val, ctx) => {
          callCount++
          if (ctx.meta?.sensitive === true) {
            return '[HIDDEN]'
          }
          return val
        },
        {
          shouldTransform: sch => getMetadata(sch)?.sensitive === true
        }
      )

      expect(result.items[0].public).toBe('a')
      expect(result.items[0].secret).toBe('[HIDDEN]')
      expect(result.items[1].public).toBe('b')
      expect(result.items[1].secret).toBe('[HIDDEN]')
      expect(callCount).toBe(2) // Only 2 calls for the 2 sensitive fields
    })

    it('should work with async transforms', async () => {
      const schema = z.object({
        name: z.string(),
        secret: z.string().meta({ sensitive: true })
      })
      const value = { name: 'John', secret: 'password' }
      let callCount = 0

      const result = await transformBySchemaAsync(
        value,
        schema,
        null,
        async (val, ctx) => {
          callCount++
          if (ctx.meta?.sensitive === true) {
            await new Promise(resolve => setTimeout(resolve, 1))
            return '[ASYNC_HIDDEN]'
          }
          return val
        },
        {
          shouldTransform: sch => getMetadata(sch)?.sensitive === true
        }
      )

      expect(result.name).toBe('John')
      expect(result.secret).toBe('[ASYNC_HIDDEN]')
      expect(callCount).toBe(1)
    })

    it('should process all fields when no predicate is provided', () => {
      const schema = z.object({
        a: z.string(),
        b: z.string(),
        c: z.string()
      })
      const value = { a: '1', b: '2', c: '3' }
      let callCount = 0

      transformBySchema(value, schema, null, val => {
        callCount++
        return val
      })

      // Called for root object + 3 fields = 4 calls
      expect(callCount).toBeGreaterThanOrEqual(3)
    })

    it('should work with discriminated unions', () => {
      const schema = z.discriminatedUnion('type', [
        z.object({
          type: z.literal('user'),
          name: z.string(),
          ssn: z.string().meta({ sensitive: true })
        }),
        z.object({
          type: z.literal('company'),
          name: z.string(),
          taxId: z.string().meta({ sensitive: true })
        })
      ])
      const userValue = { type: 'user' as const, name: 'John', ssn: '123-45-6789' }
      let callCount = 0

      const result = transformBySchema(
        userValue,
        schema,
        null,
        (val, ctx) => {
          callCount++
          if (ctx.meta?.sensitive === true) {
            return '[REDACTED]'
          }
          return val
        },
        {
          shouldTransform: sch => getMetadata(sch)?.sensitive === true
        }
      )

      expect(result.name).toBe('John')
      expect(result.ssn).toBe('[REDACTED]')
      expect(callCount).toBe(1) // Only called for ssn
    })
  })

  describe('edge cases', () => {
    it('should handle deeply nested arrays of objects', () => {
      const schema = z.object({
        levels: z.array(
          z.array(
            z.object({
              secret: z.string().meta({ sensitive: true })
            })
          )
        )
      })
      const value = {
        levels: [[{ secret: 'a' }, { secret: 'b' }], [{ secret: 'c' }]]
      }

      const result = transformBySchema(value, schema, null, (val, ctx) => {
        if (ctx.meta?.sensitive === true) {
          return `[${val}]`
        }
        return val
      })

      expect(result.levels[0][0].secret).toBe('[a]')
      expect(result.levels[0][1].secret).toBe('[b]')
      expect(result.levels[1][0].secret).toBe('[c]')
    })

    it('should handle mixed optional/nullable/sensitive', () => {
      const schema = z.object({
        field: z.string().meta({ sensitive: true }).nullable().optional()
      })

      // With value present
      const result1 = transformBySchema({ field: 'secret' }, schema, null, (val, ctx) => {
        if (ctx.meta?.sensitive === true) {
          return '[HIDDEN]'
        }
        return val
      })
      expect(result1.field).toBe('[HIDDEN]')

      // With null
      const result2 = transformBySchema({ field: null }, schema, null, val => val)
      expect(result2.field).toBeNull()

      // With undefined
      const result3 = transformBySchema({ field: undefined }, schema, null, val => val)
      expect(result3.field).toBeUndefined()
    })

    it('should not transform when transform returns same value', () => {
      const schema = z.object({
        nested: z.object({
          deep: z.string().meta({ sensitive: true })
        })
      })
      const value = { nested: { deep: 'secret' } }
      let deepVisited = false

      // Transform returns same value for nested object, so it should recurse
      const result = transformBySchema(value, schema, null, (val, ctx) => {
        if (ctx.path === 'nested.deep') {
          deepVisited = true
          return '[TRANSFORMED]'
        }
        return val
      })

      expect(deepVisited).toBe(true)
      expect(result.nested.deep).toBe('[TRANSFORMED]')
    })
  })

  describe('z.lazy() handling', () => {
    it('should transform values with z.lazy() schemas', () => {
      // Simple lazy wrapper (non-recursive)
      const lazySchema = z.lazy(() =>
        z.object({
          secret: z.string().meta({ sensitive: true })
        })
      )
      const value = { secret: 'password123' }

      const result = transformBySchema(value, lazySchema, null, (val, ctx) => {
        if (ctx.meta?.sensitive === true) {
          return '[REDACTED]'
        }
        return val
      })

      expect(result.secret).toBe('[REDACTED]')
    })

    it('should transform recursive data with recursive schemas', () => {
      // Recursive schema - Person with friends array of Person
      type Person = { name: string; ssn: string; friends: Person[] }
      const personSchema: z.ZodType<Person> = z.lazy(() =>
        z.object({
          name: z.string(),
          ssn: z.string().meta({ sensitive: true }),
          friends: z.array(personSchema)
        })
      )

      const value: Person = {
        name: 'Alice',
        ssn: '123-45-6789',
        friends: [
          {
            name: 'Bob',
            ssn: '987-65-4321',
            friends: []
          }
        ]
      }

      const result = transformBySchema(value, personSchema, null, (val, ctx) => {
        if (ctx.meta?.sensitive === true) {
          return '[REDACTED]'
        }
        return val
      })

      expect(result.name).toBe('Alice')
      expect(result.ssn).toBe('[REDACTED]')
      expect(result.friends[0].name).toBe('Bob')
      expect(result.friends[0].ssn).toBe('[REDACTED]')
    })

    it('should handle deeply nested recursive structures', () => {
      type TreeNode = { value: string; children: TreeNode[] }
      const treeSchema: z.ZodType<TreeNode> = z.lazy(() =>
        z.object({
          value: z.string().meta({ transform: true }),
          children: z.array(treeSchema)
        })
      )

      const tree: TreeNode = {
        value: 'root',
        children: [
          {
            value: 'child1',
            children: [{ value: 'grandchild', children: [] }]
          },
          { value: 'child2', children: [] }
        ]
      }

      const result = transformBySchema(tree, treeSchema, null, (val, ctx) => {
        if (ctx.meta?.transform === true && typeof val === 'string') {
          return val.toUpperCase()
        }
        return val
      })

      expect(result.value).toBe('ROOT')
      expect(result.children[0].value).toBe('CHILD1')
      expect(result.children[0].children[0].value).toBe('GRANDCHILD')
      expect(result.children[1].value).toBe('CHILD2')
    })

    it('should work with async transforms on lazy schemas', async () => {
      type Person = { name: string; secret: string; friends: Person[] }
      const personSchema: z.ZodType<Person> = z.lazy(() =>
        z.object({
          name: z.string(),
          secret: z.string().meta({ sensitive: true }),
          friends: z.array(personSchema)
        })
      )

      const value: Person = {
        name: 'Alice',
        secret: 'password',
        friends: [{ name: 'Bob', secret: 'secret123', friends: [] }]
      }

      const result = await transformBySchemaAsync(value, personSchema, null, async (val, ctx) => {
        if (ctx.meta?.sensitive === true) {
          await new Promise(resolve => setTimeout(resolve, 1))
          return '[ASYNC_REDACTED]'
        }
        return val
      })

      expect(result.secret).toBe('[ASYNC_REDACTED]')
      expect(result.friends[0].secret).toBe('[ASYNC_REDACTED]')
    })

    it('should handle empty recursive arrays', () => {
      type Node = { id: string; children: Node[] }
      const nodeSchema: z.ZodType<Node> = z.lazy(() =>
        z.object({
          id: z.string().meta({ mark: true }),
          children: z.array(nodeSchema)
        })
      )

      const value: Node = { id: 'root', children: [] }

      const result = transformBySchema(value, nodeSchema, null, (val, ctx) => {
        if (ctx.meta?.mark === true && typeof val === 'string') {
          return `marked:${val}`
        }
        return val
      })

      expect(result.id).toBe('marked:root')
      expect(result.children).toEqual([])
    })
  })

  describe('z.transform() and z.refine() handling', () => {
    it('should find metadata when applied AFTER transform', () => {
      // Recommended pattern: apply .meta() after .transform()
      const schema = z.object({
        email: z
          .string()
          .transform(s => s.toLowerCase())
          .meta({ sensitive: true })
      })
      const value = { email: 'TEST@EXAMPLE.COM' }

      const result = transformBySchema(value, schema, null, (val, ctx) => {
        if (ctx.meta?.sensitive === true) {
          return '[REDACTED]'
        }
        return val
      })

      expect(result.email).toBe('[REDACTED]')
    })

    it('should find metadata when applied AFTER refine', () => {
      // Recommended pattern: apply .meta() after .refine()
      const schema = z.object({
        password: z
          .string()
          .refine(s => s.length >= 8, 'Password too short')
          .meta({ sensitive: true })
      })
      const value = { password: 'secret123' }

      const result = transformBySchema(value, schema, null, (val, ctx) => {
        if (ctx.meta?.sensitive === true) {
          return '[REDACTED]'
        }
        return val
      })

      expect(result.password).toBe('[REDACTED]')
    })

    it('should find metadata when applied BEFORE transform (Option 1)', () => {
      // Option 1: traversal unwrap should find metadata through the pipe wrapper.
      const schema = z.object({
        email: z
          .string()
          .meta({ sensitive: true })
          .transform(s => s.toLowerCase())
      })
      const value = { email: 'TEST@EXAMPLE.COM' }

      const result = transformBySchema(value, schema, null, (val, ctx) => {
        if (ctx.meta?.sensitive === true) {
          return '[REDACTED]'
        }
        return val
      })

      expect(result.email).toBe('[REDACTED]')
    })

    it('should NOT find metadata when applied BEFORE refine (documented limitation)', () => {
      // Anti-pattern: metadata applied before refine is lost entirely
      const schema = z.object({
        password: z
          .string()
          .meta({ sensitive: true }) // Applied BEFORE - will be lost!
          .refine(s => s.length >= 8)
      })
      const value = { password: 'secret123' }

      const result = transformBySchema(value, schema, null, (val, ctx) => {
        if (ctx.meta?.sensitive === true) {
          return '[REDACTED]'
        }
        return val
      })

      // Metadata is NOT found - refine doesn't preserve inner metadata
      expect(result.password).toBe('secret123') // Not redacted
    })

    it('should work with chained transforms when meta is last', () => {
      const schema = z.object({
        value: z
          .string()
          .transform(s => s.trim())
          .transform(s => s.toLowerCase())
          .meta({ normalize: true })
      })
      const value = { value: '  HELLO  ' }

      const result = transformBySchema(value, schema, null, (val, ctx) => {
        if (ctx.meta?.normalize === true) {
          return `[${val}]`
        }
        return val
      })

      expect(result.value).toBe('[  HELLO  ]') // Transform callback sees original value
    })

    it('should work with z.coerce patterns', () => {
      // z.coerce.number() internally uses transform
      const schema = z.object({
        count: z.coerce.number().meta({ tracked: true })
      })
      const value = { count: '42' }

      let foundMeta = false
      transformBySchema(value, schema, null, (val, ctx) => {
        if (ctx.meta?.tracked === true) {
          foundMeta = true
        }
        return val
      })

      expect(foundMeta).toBe(true)
    })
  })

  describe('parallel option (M3)', () => {
    it('should process array elements in parallel when parallel: true', async () => {
      const schema = z.object({
        items: z.array(
          z.object({
            value: z.string().meta({ transform: true })
          })
        )
      })
      const value = {
        items: [{ value: 'a' }, { value: 'b' }, { value: 'c' }]
      }

      const startTimes: number[] = []
      const result = await transformBySchemaAsync(
        value,
        schema,
        null,
        async (val, ctx) => {
          if (ctx.meta?.transform === true) {
            startTimes.push(Date.now())
            await new Promise(resolve => setTimeout(resolve, 10))
            return `[${val}]`
          }
          return val
        },
        { parallel: true }
      )

      expect(result.items[0].value).toBe('[a]')
      expect(result.items[1].value).toBe('[b]')
      expect(result.items[2].value).toBe('[c]')

      // All transforms should have started at approximately the same time
      // (within 5ms of each other for parallel execution)
      if (startTimes.length === 3) {
        const maxDiff = Math.max(...startTimes) - Math.min(...startTimes)
        expect(maxDiff).toBeLessThan(10) // Started within 10ms of each other
      }
    })

    it('should process array elements sequentially by default', async () => {
      const schema = z.object({
        items: z.array(
          z.object({
            value: z.string().meta({ transform: true })
          })
        )
      })
      const value = {
        items: [{ value: 'a' }, { value: 'b' }, { value: 'c' }]
      }

      const startTimes: number[] = []
      const result = await transformBySchemaAsync(
        value,
        schema,
        null,
        async (val, ctx) => {
          if (ctx.meta?.transform === true) {
            startTimes.push(Date.now())
            await new Promise(resolve => setTimeout(resolve, 10))
            return `[${val}]`
          }
          return val
        }
        // parallel: false is default
      )

      expect(result.items[0].value).toBe('[a]')
      expect(result.items[1].value).toBe('[b]')
      expect(result.items[2].value).toBe('[c]')

      // Transforms should have started sequentially (with ~10ms gaps)
      if (startTimes.length === 3) {
        const diff1 = startTimes[1] - startTimes[0]
        const diff2 = startTimes[2] - startTimes[1]
        expect(diff1).toBeGreaterThanOrEqual(8) // Each waited for the previous
        expect(diff2).toBeGreaterThanOrEqual(8)
      }
    })

    it('should handle nested arrays in parallel', async () => {
      const schema = z.object({
        outer: z.array(
          z.object({
            inner: z.array(
              z.object({
                value: z.string().meta({ transform: true })
              })
            )
          })
        )
      })
      const value = {
        outer: [{ inner: [{ value: 'a' }, { value: 'b' }] }, { inner: [{ value: 'c' }] }]
      }

      const result = await transformBySchemaAsync(
        value,
        schema,
        null,
        async (val, ctx) => {
          if (ctx.meta?.transform === true) {
            await new Promise(resolve => setTimeout(resolve, 1))
            return `[${val}]`
          }
          return val
        },
        { parallel: true }
      )

      expect(result.outer[0].inner[0].value).toBe('[a]')
      expect(result.outer[0].inner[1].value).toBe('[b]')
      expect(result.outer[1].inner[0].value).toBe('[c]')
    })

    it('should work with empty arrays in parallel mode', async () => {
      const schema = z.object({
        items: z.array(z.string().meta({ transform: true }))
      })
      const value = { items: [] as string[] }

      const result = await transformBySchemaAsync(
        value,
        schema,
        null,
        async (val, ctx) => {
          if (ctx.meta?.transform === true) {
            return `[${val}]`
          }
          return val
        },
        { parallel: true }
      )

      expect(result.items).toEqual([])
    })

    it('should preserve order in parallel mode', async () => {
      const schema = z.array(z.string().meta({ transform: true }))
      const value = ['first', 'second', 'third', 'fourth', 'fifth']

      // Simulate varying processing times
      const delays = [50, 10, 30, 20, 5]
      let index = 0

      const result = await transformBySchemaAsync(
        value,
        schema,
        null,
        async (val, ctx) => {
          if (ctx.meta?.transform === true) {
            const delay = delays[index++]
            await new Promise(resolve => setTimeout(resolve, delay))
            return `[${val}]`
          }
          return val
        },
        { parallel: true }
      )

      // Despite different delays, order should be preserved
      expect(result).toEqual(['[first]', '[second]', '[third]', '[fourth]', '[fifth]'])
    })
  })
})
