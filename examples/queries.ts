/**
 * Copy-paste ready builder setup for your Convex project.
 *
 * Place this file in your convex/ directory (e.g., convex/util.ts or convex/queries.ts)
 * and customize the auth logic to match your app's needs.
 */

import {
  query,
  mutation,
  action,
  internalQuery,
  internalMutation,
  internalAction
} from './_generated/server'
import type { QueryCtx, MutationCtx, ActionCtx } from './_generated/server'
import { ConvexError } from 'convex/values'
import {
  zQueryBuilder,
  zMutationBuilder,
  zActionBuilder,
  zCustomQueryBuilder,
  zCustomMutationBuilder,
  zCustomActionBuilder,
  customCtx
} from 'zodvex'

// ============================================================================
// Basic Builders (no auth required)
// ============================================================================

export const zq = zQueryBuilder(query)
export const zm = zMutationBuilder(mutation)
export const za = zActionBuilder(action)

// Internal builders (not exposed to client)
export const ziq = zQueryBuilder(internalQuery)
export const zim = zMutationBuilder(internalMutation)
export const zia = zActionBuilder(internalAction)

// ============================================================================
// Custom Auth Builders
// ============================================================================

/**
 * Authenticated query builder.
 * Adds `user` to context or null if not authenticated.
 */
export const authQuery = zCustomQueryBuilder(
  query,
  customCtx(async (ctx: QueryCtx) => {
    const user = await getUser(ctx)
    return { user }
  })
)

/**
 * Authenticated mutation builder.
 * Adds `user` to context. Throws if not authenticated.
 */
export const authMutation = zCustomMutationBuilder(
  mutation,
  customCtx(async (ctx: MutationCtx) => {
    return { user: await getUserOrThrow(ctx) }
  })
)

/**
 * Authenticated action builder.
 * Adds `user` to context. Throws if not authenticated.
 */
export const authAction = zCustomActionBuilder(
  action,
  customCtx(async (ctx: ActionCtx) => {
    return { user: await getUserOrThrow(ctx) }
  })
)

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the current user (or null if not authenticated).
 * Customize this to match your auth provider (Clerk, Auth0, etc.)
 */
async function getUser(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) return null

  const user = await ctx.db
    .query('users')
    .withIndex('by_token_id', q => q.eq('tokenId', identity.subject))
    .first()

  return user ?? null
}

/**
 * Get the current user or throw an error.
 */
async function getUserOrThrow(ctx: QueryCtx | MutationCtx) {
  const user = await getUser(ctx)
  if (!user) {
    throw new ConvexError('Not authenticated')
  }
  return user
}
