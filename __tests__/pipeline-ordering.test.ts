import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { customFnBuilder } from '../src/custom'
import { zx } from '../src/zx'

// Minimal builder stub that mimics Convex builder
function makeBuilder() {
  return function builder(config: {
    args?: any
    returns?: any
    handler: (ctx: any, args: any) => any
  }) {
    return async (ctx: any, args: any) => config.handler(ctx, args)
  }
}

describe('Pipeline ordering: onSuccess sees runtime types', () => {
  it('onSuccess receives Date instances, not timestamps', async () => {
    const builder = makeBuilder()
    let onSuccessResult: any = null

    const customization = {
      args: {},
      input: async () => ({
        ctx: {},
        args: {},
        hooks: {
          onSuccess: ({ result }: any) => {
            onSuccessResult = result
          }
        }
      })
    }

    const myBuilder = customFnBuilder(builder as any, customization)

    const fn = myBuilder({
      args: { when: zx.date() },
      returns: z.object({ when: zx.date() }),
      handler: async (_ctx: any, args: any) => {
        return { when: args.when } // args.when is a Date after Zod parse
      }
    }) as any

    const timestamp = new Date('2025-06-15T00:00:00Z').getTime()
    await fn({}, { when: timestamp })

    // CRITICAL: onSuccess must see the Date instance, NOT the encoded timestamp
    expect(onSuccessResult).not.toBeNull()
    expect(onSuccessResult.when).toBeInstanceOf(Date)
    expect(onSuccessResult.when.getTime()).toBe(timestamp)
  })

  it('wire result returned to client is a timestamp (not a Date)', async () => {
    const builder = makeBuilder()

    const customization = {
      args: {},
      input: async () => ({
        ctx: {},
        args: {},
        hooks: {
          onSuccess: () => {
            // onSuccess sees runtime types — verified in other test
          }
        }
      })
    }

    const myBuilder = customFnBuilder(builder as any, customization)

    const fn = myBuilder({
      args: { when: zx.date() },
      returns: z.object({ when: zx.date() }),
      handler: async (_ctx: any, args: any) => {
        return { when: args.when }
      }
    }) as any

    const timestamp = new Date('2025-06-15T00:00:00Z').getTime()
    const wireResult = await fn({}, { when: timestamp })

    // Wire result must be encoded (number, not Date)
    expect(typeof wireResult.when).toBe('number')
    expect(wireResult.when).toBe(timestamp)
  })
})
