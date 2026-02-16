import { createDatabaseHooks, composeHooks, initZodvex } from 'zodvex/server'
import schema from './schema'
import * as server from './_generated/server'

// ============================================================================
// Initialize zodvex — one-time setup
// ============================================================================

export const {
  zq, zm, za,
  ziq, zim, zia,
  zCustomCtx,
} = initZodvex(schema, server)

// ============================================================================
// Context Customization
// ============================================================================

/** Simple auth context — adds user to ctx */
const authCtx = zCustomCtx(async (ctx: any) => {
  // In a real app: const identity = await ctx.auth.getUserIdentity()
  const user = { name: 'Test User', role: 'user' }
  return { user }
})

/** Admin context with ExtraArgs for required roles */
const adminCtx = zCustomCtx(async (ctx: any, extra?: { required?: string[] }) => {
  const user = { name: 'Admin User', role: 'admin' }
  if (extra?.required && !extra.required.includes(user.role)) {
    throw new Error(`Missing required role: ${extra.required.join(', ')}`)
  }
  return { user }
})

// ============================================================================
// DB Hooks
// ============================================================================

/** Logging hook — logs after decode */
const loggingHooks = createDatabaseHooks<{ user: { name: string } }>({
  decode: {
    after: {
      one: async (ctx, doc) => {
        // In a real app: audit log
        console.log(`[read] ${ctx.table} by ${ctx.user.name}`)
        return doc
      },
    },
  },
})

/** Validation hook — checks admin role before decode */
const validationHooks = createDatabaseHooks<{ user: { role: string } }>({
  decode: {
    before: {
      one: async (ctx, doc) => {
        if (ctx.user.role !== 'admin') return null // deny
        return doc
      },
    },
  },
})

const adminHooks = composeHooks([validationHooks, loggingHooks])

// ============================================================================
// Composed Builders
// ============================================================================

export const authQuery = zq.withContext(authCtx)
export const authMutation = zm.withContext(authCtx)
export const adminQuery = zq.withContext(adminCtx).withHooks(adminHooks)
export const adminMutation = zm.withContext(adminCtx).withHooks(adminHooks)
