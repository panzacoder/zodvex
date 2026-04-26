import { z } from 'zod/mini'
import { zx } from 'zodvex/mini'
import { api } from './_generated/api'
import { za } from './functions'

// Simple action with .withContext() to verify action context types work.
// If za.withContext() collapsed ctx to { [k: string]: never }, this would
// fail type-checking because ctx.auth would not be accessible.
const authedAction = za.withContext({
  args: {},
  input: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    return {
      ctx: { userId: identity?.subject ?? 'anonymous' },
      args: {},
    }
  },
})

export const ping = authedAction({
  args: { message: z.string() },
  handler: async (ctx, { message }) => {
    // ctx.userId comes from .withContext() customization
    return `${ctx.userId}: ${message}`
  },
  returns: z.string(),
})

// Base za (no withContext) should also type-check — ctx.auth must be accessible
export const health = za({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    return identity ? 'authenticated' : 'anonymous'
  },
  returns: z.string(),
})

// Exercises the registry path: `ctx.runQuery` goes through the boundary codec,
// which forces the lazy `() => (await import('./_zodvex/api.js')).zodvexRegistry`
// thunk to resolve. If the dynamic import is broken (path mismatch, bundler
// stripping, registry shape change), this action throws.
//
// Used by test/smoke.ts to verify the lazy-import pattern survives a real
// Convex deploy.
export const resolveUserViaAction = za({
  args: { id: zx.id('users') },
  handler: async (ctx, { id }): Promise<string | null> => {
    const user = await ctx.runQuery(api.users.get, { id })
    return user?.name ?? null
  },
  returns: z.union([z.string(), z.null()]),
})
