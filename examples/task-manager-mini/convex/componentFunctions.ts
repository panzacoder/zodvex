/**
 * Demonstrates module-scope component instantiation alongside zodvex exports.
 * This is the exact pattern from hotpot's visits/dropIn.ts that motivated
 * the discovery stub work in discovery-hooks.ts.
 *
 * During codegen discovery, `_generated/api` is stubbed with a Proxy so that
 * `components.*` property access and constructor calls succeed silently.
 */
import { z } from 'zod/mini'
import { zx } from 'zodvex/core'
import { ActionRetrier } from '@convex-dev/action-retrier'
import { components } from './_generated/api'
import { zq, zm, za } from './functions'

// --- Published component: action-retrier ---
// Module-scope instantiation — the class is imported from the npm package,
// the component reference comes from _generated/api.
// This is the pattern that fails without the Proxy stub during discovery.
const retrier = new ActionRetrier(components.actionRetrier)

// --- Local/custom component ---
// Same pattern but for a hypothetical local component. In a real project this
// would be something like:
//   import { LocalDTA } from '@doxyme/convex-local-dta'
//   const localDTA = new LocalDTA(components.localDTA)
// Here we simulate with a direct components.* access to validate the Proxy.
const analytics = (components as any).analytics

// --- Zodvex-wrapped exports coexisting with component instantiation ---

export const retryableAction = za({
  args: { taskId: zx.id('tasks'), attempt: z.optional(z.number()) },
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
