/**
 * Cross-table cleanup utility — type inference reproduction.
 *
 * Tests the pattern from hotpot retention.ts:
 * - Dynamic `table: TableNames` → .withIndex() → .gt()/.lt()
 * - Field is a plain z.number().optional() (no codec)
 * - Value arguments are plain numbers
 *
 * With zodvex/core (baseline): value type is `number | "required"` → accepts numbers ✓
 * With zodvex/mini (post-codemod): value type may resolve to `undefined` → rejects numbers ✗
 *
 * To test: type-check this file, then change model imports to zodvex/mini
 * and type-check again to see if the value type changes.
 */

import { z } from 'zod/mini'
import type { TableNames } from './_generated/dataModel'
import { zim } from './functions'

const CLEANUP_INDEX = 'by_completed' as const
const CLEANUP_FIELD = 'completedAt' as const
const BATCH_SIZE = 100

/**
 * Query tasks completed within a time range.
 * Single-table case — should work with both core and mini.
 */
export const queryCompletedTasks = zim({
  args: {
    after: z.number(),
    before: z.number(),
  },
  handler: async (ctx, { after, before }) => {
    // Single table: 'tasks' has by_completed index on completedAt (zx.date() codec)
    // The decoded type is Date, wire type is number.
    const afterDate = new Date(after)
    const beforeDate = new Date(before)
    return ctx.db
      .query('tasks')
      .withIndex(CLEANUP_INDEX, (q) =>
        q.gt(CLEANUP_FIELD, afterDate).lt(CLEANUP_FIELD, beforeDate)
      )
      .take(BATCH_SIZE)
  },
  returns: z.array(z.any()),
})

/**
 * Dynamic table query — uses createdAt which ALL tables have.
 * table: TableNames creates a union type that challenges type inference.
 *
 * createdAt is zx.date() (wire: number, runtime: Date).
 * With the zodvex-wrapped index builder, Date should be accepted.
 * Without it, only number is accepted.
 */
export const deleteOldDocs = zim({
  args: {
    table: z.string(),
    cutoffTimestamp: z.number(),
  },
  handler: async (ctx, { table, cutoffTimestamp }) => {
    // Dynamic table query — this is the pattern that may break after codemod
    const oldDocs = await ctx.db
      .query(table as TableNames)
      .withIndex('by_created', (q) => q.lt('createdAt', new Date(cutoffTimestamp)))
      .take(BATCH_SIZE)

    for (const doc of oldDocs as any[]) {
      await ctx.db.delete(doc._id)
    }

    return oldDocs.length
  },
  returns: z.number(),
})
