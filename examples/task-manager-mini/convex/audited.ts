import { z } from 'zod/mini'
import { defineContext } from 'zodvex/mini/server'
import { zm, zim } from './functions'

// One customization, authored with `defineContext` — full inference, zero
// hand-annotations on `input` — applied to BOTH the public and internal mutation
// builder. `zm` and `zim` share the same input ctx, so a single customization
// feeds both, which keeps the public/internal variants from drifting.
// See docs/guide/custom-context.md.
const auditedContext = defineContext(zm, {
  args: {},
  // ctx is the codec-wrapped mutation ctx (fully typed, no annotation needed);
  // the customization adds `actor`, which both handlers below can read.
  input: async (ctx, _args, extra?: { actor?: string }) => ({
    ctx: { ...ctx, actor: extra?.actor ?? 'system' },
    args: {},
  }),
})

export const auditedMutation = zm.withContext(auditedContext)
export const auditedInternalMutation = zim.withContext(auditedContext)

// Public mutation: ctx.actor comes from the shared customization.
export const touch = auditedMutation({
  args: { note: z.string() },
  handler: async (ctx, { note }) => `${ctx.actor}: ${note}`,
  returns: z.string(),
})

// Internal mutation built from the SAME customization object.
export const internalTouch = auditedInternalMutation({
  args: {},
  handler: async (ctx) => ctx.actor,
  returns: z.string(),
})
