import { customCtx } from 'convex-helpers/server/customFunctions'
import { initZodvex } from 'zodvex/server'
import schema from './schema'
import * as server from './_generated/server'

// ============================================================================
// Initialize zodvex — one-time setup
// ============================================================================

export const {
  zQuery, zMutation, zAction,
  zInternalQuery, zInternalMutation, zInternalAction,
  zCustomQuery, zCustomMutation, zCustomAction,
} = initZodvex(schema, server)

// ============================================================================
// Blessed Builders with Context Customization
// ============================================================================

/** Auth-aware query builder — adds user to ctx */
export const authQuery = zCustomQuery(
  customCtx(async (ctx: any) => {
    // In a real app: const identity = await ctx.auth.getUserIdentity()
    const user = { name: 'Test User', role: 'user' }
    return { user }
  })
)

/** Auth-aware mutation builder */
export const authMutation = zCustomMutation(
  customCtx(async (ctx: any) => {
    const user = { name: 'Test User', role: 'user' }
    return { user }
  })
)

/** Admin query builder with security filtering via customCtx */
export const adminQuery = zCustomQuery(
  customCtx(async (ctx: any) => {
    const user = { name: 'Admin User', role: 'admin' }
    // Security filtering is now done by wrapping ctx.db in customCtx
    // (via hotpot's createSecureReader or equivalent)
    return { user }
  })
)

/** Admin mutation builder */
export const adminMutation = zCustomMutation(
  customCtx(async (ctx: any) => {
    const user = { name: 'Admin User', role: 'admin' }
    return { user }
  })
)
