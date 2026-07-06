import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import { createZodDbWriter } from 'zodvex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')

/**
 * End-to-end coverage for issue #82: the zodvex secure writer must let a
 * `patch(id, { field: undefined })` delete an optional field, matching native
 * Convex `patch` semantics. Previously `stripUndefined` dropped the key before
 * Convex saw it, turning an intended unset into a silent no-op.
 *
 * These run against convex-test's emulated backend through the real secure
 * writer (createZodDbWriter → encodePartialDoc → db.patch).
 */
describe('secure writer patch can unset optional fields (issue #82)', () => {
  async function seedTask(t: ReturnType<typeof convexTest>, extra: Record<string, unknown>) {
    return await t.run(async (ctx) => {
      const ownerId = await ctx.db.insert('users', {
        name: 'Alice',
        email: { value: 'alice@test.com', tag: 'test' },
        createdAt: Date.now(),
      } as any)
      return await ctx.db.insert('tasks', {
        title: 'T',
        status: 'todo',
        priority: null,
        ownerId,
        createdAt: Date.now(),
        ...extra,
      } as any)
    })
  }

  test('deletes a plain optional field (description)', async () => {
    const t = convexTest(schema, modules)
    const id = await seedTask(t, { description: 'temporary note' })

    await t.run(async (ctx) => {
      const before = await ctx.db.get(id)
      expect((before as any).description).toBe('temporary note')

      const zdb = createZodDbWriter(ctx.db as any, schema as any)
      await zdb.patch(id as any, { description: undefined } as any)

      const after = await ctx.db.get(id)
      expect('description' in (after as any)).toBe(false)
    })
  })

  test('deletes an optional codec field (dueDate via zx.date)', async () => {
    const t = convexTest(schema, modules)
    const id = await seedTask(t, { dueDate: Date.now() })

    await t.run(async (ctx) => {
      const before = await ctx.db.get(id)
      expect(typeof (before as any).dueDate).toBe('number')

      const zdb = createZodDbWriter(ctx.db as any, schema as any)
      await zdb.patch(id as any, { dueDate: undefined } as any)

      const after = await ctx.db.get(id)
      expect('dueDate' in (after as any)).toBe(false)
    })
  })

  test('does not unset fields that are simply absent from the patch', async () => {
    const t = convexTest(schema, modules)
    const id = await seedTask(t, { description: 'keep me' })

    await t.run(async (ctx) => {
      const zdb = createZodDbWriter(ctx.db as any, schema as any)
      // Patch a different field; `description` is absent (not undefined) — must remain.
      await zdb.patch(id as any, { title: 'renamed' } as any)

      const after = await ctx.db.get(id)
      expect((after as any).title).toBe('renamed')
      expect((after as any).description).toBe('keep me')
    })
  })
})
