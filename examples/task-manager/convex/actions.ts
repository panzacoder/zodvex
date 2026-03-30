import { z } from 'zod'
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
