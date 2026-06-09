import { describe, expect, expectTypeOf, it } from 'vitest'
import { defineContext, initZodvex } from '../src/internal/init'

// #72 fallout: 0.7.3 retyped `.withContext()` so `input`'s args param is
// `z.output<$ZodObject<ZArgs>>`, which widens to `{ [x: string]: unknown }` for
// empty args. Inline customizations dodge it via contextual inference, but a
// STANDALONE shared customization (extracted so zm + zim use one object) must
// hand-annotate `input`'s params (no contextual type + noImplicitAny), and
// `Record<string, never>` is not assignable to `{ [x: string]: unknown }` → TS2345.
//
// Fix 1: empty/absent args resolve to `Record<string, never>`.
// Fix 2: `defineContext(builder, customization)` — an inference site that pins the
// builder's input ctx (so `input`'s ctx/args need no annotation) and infers the
// output generics from the value, returning a customization usable by BOTH
// same-kind builders (zm + zim, za + zia, zq + ziq).

const mockServer = {
  query: (f: any) => f,
  mutation: (f: any) => f,
  action: (f: any) => f,
  internalQuery: (f: any) => f,
  internalMutation: (f: any) => f,
  internalAction: (f: any) => f
}
const mockSchema = { __zodTableMap: {} as any, __decodedDocs: {} as any }

describe('#72 fallout — empty/standalone customization args (Fix 1)', () => {
  it('a standalone customization annotating _args: Record<string, never> compiles for zm AND zim', () => {
    const { zm, zim } = initZodvex(mockSchema, mockServer as any)
    // Standalone object literal → no contextual inference → params hand-annotated.
    const shared = {
      args: {},
      input: async (ctx: any, _args: Record<string, never>, _extra?: { required?: string[] }) => ({
        ctx,
        args: {}
      })
    }
    // Regressed in 0.7.3 with TS2345 at both call sites; must compile now.
    expect(typeof zm.withContext(shared)).toBe('function')
    expect(typeof zim.withContext(shared)).toBe('function')
  })
})

describe('defineContext — shared customization with full inference (Fix 2)', () => {
  it('is an identity at runtime', () => {
    const { zm } = initZodvex(mockSchema, mockServer as any)
    const c = { args: {}, input: async (ctx: any) => ({ ctx, args: {} }) }
    expect(defineContext(zm, c)).toBe(c)
  })

  it('one mutation context feeds both zm and zim with zero input annotations', () => {
    const { zm, zim } = initZodvex(mockSchema, mockServer as any)
    const mutationContext = defineContext(zm, {
      args: {},
      // No annotations: `ctx` is contextually typed by defineContext, args inferred.
      input: async (ctx, _args, _extra?: { required?: string[] }) => {
        // ctx is the real codec-wrapped mutation ctx (not `any`/`never`) — the
        // value of the blessed path is that the handler keeps precise ctx types.
        expectTypeOf(ctx.db).not.toBeNever()
        expectTypeOf(ctx.db).not.toBeAny()
        return { ctx: { ...ctx, who: 'authed' as const }, args: {} }
      }
    })
    expect(typeof zm.withContext(mutationContext)).toBe('function')
    expect(typeof zim.withContext(mutationContext)).toBe('function')
  })

  it('one action context feeds both za and zia', () => {
    const { za, zia } = initZodvex(mockSchema, mockServer as any)
    const actionContext = defineContext(za, {
      args: {},
      input: async (ctx, _args) => {
        // Action ctx narrows to a real ActionCtx (runQuery/scheduler/etc.).
        expectTypeOf(ctx.runAction).not.toBeNever()
        expectTypeOf(ctx.scheduler).not.toBeNever()
        return { ctx: { ...ctx, who: 'authed' as const }, args: {} }
      }
    })
    expect(typeof za.withContext(actionContext)).toBe('function')
    expect(typeof zia.withContext(actionContext)).toBe('function')
  })
})
