import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import { z } from 'zod'
import { zx } from 'zodvex'
import { api } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')

/**
 * End-to-end coverage for zodvex#92: convex-helpers triggers fire inside
 * zodvex-wrapped mutations when composed via `initZodvex({ underlyingDb })`.
 *
 * Stack under test: codec (zodvex) → triggers (convex-helpers) → convex-test db.
 *
 * The trigger on `tasks` (see triggersCompose.ts) writes a triggerLog row
 * recording the raw dueDate value it observed, and maintains an
 * aggregate-style per-owner count in taskCounts — the exact table-trigger
 * pattern that previously forced downstream apps onto DirectAggregate.
 */
describe('convex-helpers triggers under the zodvex codec layer (issue #92)', () => {
  async function seedUser(t: ReturnType<typeof convexTest>) {
    return await t.run(async (ctx) => {
      return await ctx.db.insert('users', {
        name: 'Alice',
        email: { value: 'alice@test.com', tag: 'test' },
        createdAt: Date.now(),
      } as any)
    })
  }

  const DUE = 1700000000000
  const wireCreateArgs = (ownerId: string, dueDate?: Date) =>
    z.encode(
      z.object({
        title: z.string(),
        ownerId: zx.id('users'),
        dueDate: zx.date().optional(),
      }),
      { title: 'Trigger me', ownerId: ownerId as any, dueDate }
    ) as any

  test('trigger fires on insert and observes the codec field in wire format', async () => {
    const t = convexTest(schema, modules)
    const ownerId = await seedUser(t)

    const taskId = await t.mutation(
      api.triggersCompose.createTask,
      wireCreateArgs(ownerId, new Date(DUE))
    )

    const log = await t.run(async (ctx) => ctx.db.query('triggerLog').collect())
    expect(log).toHaveLength(1)
    expect(log[0].taskId).toBe(taskId)
    expect(log[0].operation).toBe('insert')
    // Encode ordering pinned: the trigger saw a number (wire), never a Date.
    expect(log[0].wireDueDateType).toBe('number')
    expect(log[0].wireDueDate).toBe(DUE)

    // The stored task itself is wire format too.
    const task = await t.run(async (ctx) => ctx.db.get(taskId))
    expect(typeof (task as any).dueDate).toBe('number')
  })

  test('trigger fires on patch and delete through the codec writer', async () => {
    const t = convexTest(schema, modules)
    const ownerId = await seedUser(t)
    const taskId = await t.mutation(
      api.triggersCompose.createTask,
      wireCreateArgs(ownerId, new Date(DUE))
    )

    const NEW_DUE = 1800000000000
    await t.mutation(api.triggersCompose.rescheduleTask, {
      taskId,
      dueDate: NEW_DUE, // wire format at the function boundary
    } as any)

    await t.mutation(api.triggersCompose.removeTask, { taskId } as any)

    const log = await t.run(async (ctx) => ctx.db.query('triggerLog').collect())
    expect(log.map((l: any) => l.operation)).toEqual(['insert', 'update', 'delete'])
    // Update: patched Date arrived at the trigger as the encoded number.
    expect(log[1].wireDueDate).toBe(NEW_DUE)
    expect(log[1].wireDueDateType).toBe('number')
  })

  test('aggregate-style count stays correct through zodvex mutations', async () => {
    const t = convexTest(schema, modules)
    const ownerId = await seedUser(t)

    const id1 = await t.mutation(api.triggersCompose.createTask, wireCreateArgs(ownerId))
    await t.mutation(api.triggersCompose.createTask, wireCreateArgs(ownerId, new Date(DUE)))
    expect(await t.query(api.triggersCompose.getOwnerCount, { ownerId } as any)).toBe(2)

    // Patch is not a count change
    await t.mutation(api.triggersCompose.rescheduleTask, { taskId: id1, dueDate: DUE } as any)
    expect(await t.query(api.triggersCompose.getOwnerCount, { ownerId } as any)).toBe(2)

    await t.mutation(api.triggersCompose.removeTask, { taskId: id1 } as any)
    expect(await t.query(api.triggersCompose.getOwnerCount, { ownerId } as any)).toBe(1)
  })

  test('non-composed zodvex mutations (plain zm) do not fire the trigger', async () => {
    const t = convexTest(schema, modules)
    const ownerId = await seedUser(t)

    // api.tasks.create uses the app's plain zm from functions.ts (no underlyingDb)
    await t.mutation(api.tasks.create, { title: 'no trigger', ownerId } as any)

    const log = await t.run(async (ctx) => ctx.db.query('triggerLog').collect())
    expect(log).toHaveLength(0)
  })
})
