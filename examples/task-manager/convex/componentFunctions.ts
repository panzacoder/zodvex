/**
 * Demonstrates module-scope component instantiation alongside zodvex exports.
 * This is the exact pattern from hotpot's visits/dropIn.ts that motivated
 * the discovery stub work in discovery-hooks.ts.
 *
 * During codegen discovery, `_generated/api` is stubbed with a Proxy so that
 * `components.*` property access and constructor calls succeed silently.
 */
import { z } from 'zod'
import { zx } from 'zodvex/core'
import { components } from './_generated/api'
import { zq, zm, za } from './functions'

// --- Published component: action-retrier ---
// Module-scope instantiation from components.* — this is the pattern that
// fails without the Proxy stub in _generated/api during discovery.
const retrier = new (components as any).actionRetrier.lib.ActionRetrier(
  components.actionRetrier
)

// --- Local/custom component ---
// Same pattern but for a hypothetical local component. In a real project this
// would be something like `new LocalDTA(components.localDTA)`.
const analytics = new (components as any).analytics.lib.Analytics(
  components.analytics
)

// --- Zodvex-wrapped exports coexisting with component instantiation ---

export const retryableAction = za({
  args: { taskId: zx.id('tasks'), attempt: z.number().optional() },
  handler: async (_ctx, { taskId, attempt }) => {
    // In a real app, this would use the retrier to schedule an action
    // that can be retried on failure
    void retrier
    void analytics
    console.log(`Processing task ${taskId}, attempt ${attempt ?? 1}`)
  },
})

export const getTaskById = zq({
  args: { taskId: zx.id('tasks') },
  handler: async (ctx, { taskId }) => {
    // Use analytics component reference to validate it was instantiated
    void analytics
    return await ctx.db.get(taskId)
  },
})
