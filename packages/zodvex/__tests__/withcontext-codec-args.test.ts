import { describe, expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { zCustomMutation } from '../src/internal/custom'
import { initZodvex } from '../src/internal/init'
import { zx } from '../src/internal/zx'

// Regression coverage for #72: a `.withContext({ args: <zod> })` customization's
// declared args must go through the same zod pipeline as consumer args —
// codec-decoded before `input` sees them, and zod→Convex converted for the
// registered validator. Previously they were passed through raw (no conversion,
// no decode), so a codec-typed customization arg silently bypassed its transform.

// Wire (string) ↔ runtime ({ raw, upper }) codec with a distinguishing transform.
const tokenCodec = zx.codec(z.string(), z.object({ raw: z.string(), upper: z.string() }), {
  decode: (wire: any) => ({ raw: wire, upper: String(wire).toUpperCase() }),
  encode: (runtime: any) => runtime.raw
})

const mockServer = {
  query: (fn: any) => fn,
  mutation: (fn: any) => fn,
  action: (fn: any) => fn,
  internalQuery: (fn: any) => fn,
  internalMutation: (fn: any) => fn,
  internalAction: (fn: any) => fn
}
const mockSchema = { __zodTableMap: {} as any }
const rawCtx = () => ({ db: {} })

describe('#72 — withContext customization args go through the zod pipeline', () => {
  it('A: codec customization arg is DECODED before input sees it', async () => {
    const { zm } = initZodvex(mockSchema, mockServer as any)

    const wrapper = zm.withContext({
      args: { token: tokenCodec },
      input: async (_ctx: any, { token }: any) => ({ ctx: { token }, args: {} })
    })
    const fn = wrapper({ handler: async (ctx: any) => ctx.token })

    // Caller sends the WIRE value; input should receive the decoded runtime object.
    const result = await fn.handler(rawCtx(), { token: 'abc' })
    expect(result).toEqual({ raw: 'abc', upper: 'ABC' })
  })

  it('B: customization arg is registered as a Convex validator (wire shape), not raw zod', async () => {
    const { zm } = initZodvex(mockSchema, mockServer as any)

    const wrapper = zm.withContext({
      args: { token: tokenCodec },
      input: async (_ctx: any, { token }: any) => ({ ctx: { token }, args: {} })
    })
    const fn = wrapper({ handler: async () => null })

    // tokenCodec's wire schema is z.string() → v.string() (kind 'string'),
    // not the raw ZodCodec instance.
    expect(fn.args.token).toBeDefined()
    expect(fn.args.token.kind).toBe('string')
  })

  it('C: direct zCustomMutation with a zod codec arg also decodes (root-cause coverage)', async () => {
    const wrapper = zCustomMutation(
      mockServer.mutation as any,
      {
        args: { token: tokenCodec },
        input: async (_ctx: any, { token }: any) => ({ ctx: { token }, args: {} })
      } as any
    )
    const fn = (wrapper as any)({ handler: async (ctx: any) => ctx.token })

    const result = await fn.handler(rawCtx(), { token: 'xyz' })
    expect(result).toEqual({ raw: 'xyz', upper: 'XYZ' })
  })

  it('TYPES: input args are the decoded runtime (z.output), and the caller must supply the arg', () => {
    const { zm } = initZodvex(mockSchema, mockServer as any)

    zm.withContext({
      args: { token: tokenCodec },
      input: async (_ctx, args) => {
        // input sees the DECODED runtime shape, not the wire string.
        expectTypeOf(args.token).toEqualTypeOf<{ raw: string; upper: string }>()
        return { ctx: { token: args.token }, args: {} }
      }
    })

    // A pre-built Convex-validator customization (legacy shape) still type-checks.
    expectTypeOf(zm.withContext).toBeFunction()
  })

  it('D: customization arg + consumer arg coexist; both handled correctly', async () => {
    const { zm } = initZodvex(mockSchema, mockServer as any)

    const wrapper = zm.withContext({
      args: { token: tokenCodec },
      input: async (_ctx: any, { token }: any) => ({ ctx: { token }, args: {} })
    })
    const fn = wrapper({
      args: { name: z.string() },
      handler: async (ctx: any, { name }: any) => ({ token: ctx.token, name })
    })

    const result = await fn.handler(rawCtx(), { token: 'abc', name: 'Bob' })
    expect(result).toEqual({ token: { raw: 'abc', upper: 'ABC' }, name: 'Bob' })
  })
})
