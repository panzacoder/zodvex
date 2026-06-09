import { z } from 'zod'
import { za } from './functions'

// Action .withContext() must narrow ctx to a real ActionCtx. Guards the action
// context-collapse regression (#72 side effect): with an `extra?` param present,
// the input ctx previously collapsed to `Record<string, never>`, forcing an
// explicit `ActionCtx` annotation. It now infers cleanly — ctx.auth, ctx.runQuery,
// and ctx.scheduler are all accessible with no annotation.
const authedAction = za.withContext({
  args: {},
  input: async (ctx, _args, _extra?: { required?: string[] }) => {
    void ctx.runQuery
    void ctx.scheduler
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
