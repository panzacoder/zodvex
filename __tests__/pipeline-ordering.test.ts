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

// Simulate hotpot's SensitiveField codec
const PRIVATE_VALUES = new WeakMap<any, unknown>()

class SensitiveWrapper {
  public readonly status: 'full' | 'hidden'
  constructor(value: unknown, status: 'full' | 'hidden') {
    PRIVATE_VALUES.set(this, value)
    this.status = status
  }
  static full(value: unknown) {
    return new SensitiveWrapper(value, 'full')
  }
  static hidden() {
    return new SensitiveWrapper(null, 'hidden')
  }
  expose() {
    if (this.status === 'hidden') throw new Error('Cannot expose hidden')
    return PRIVATE_VALUES.get(this)
  }
  toWire() {
    return {
      value: this.status === 'full' ? PRIVATE_VALUES.get(this) : null,
      status: this.status
    }
  }
}

const sensitiveString = zx.codec(
  z.object({ value: z.string().nullable(), status: z.enum(['full', 'hidden']) }),
  z.custom<SensitiveWrapper>(val => val instanceof SensitiveWrapper),
  {
    decode: (wire: any) =>
      wire.status === 'hidden' ? SensitiveWrapper.hidden() : SensitiveWrapper.full(wire.value),
    encode: (runtime: SensitiveWrapper) => runtime.toWire()
  }
)

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
        return { when: args.when }
      }
    }) as any

    const timestamp = new Date('2025-06-15T00:00:00Z').getTime()
    await fn({}, { when: timestamp })

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
            /* noop */
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

    expect(typeof wireResult.when).toBe('number')
    expect(wireResult.when).toBe(timestamp)
  })

  it('onSuccess receives SensitiveWrapper instances for audit logging', async () => {
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
      args: {},
      returns: z.object({ email: sensitiveString }),
      handler: async () => {
        return { email: SensitiveWrapper.full('user@example.com') }
      }
    }) as any

    const wireResult = await fn({}, {})

    // onSuccess sees SensitiveWrapper instance
    expect(onSuccessResult.email).toBeInstanceOf(SensitiveWrapper)
    expect(onSuccessResult.email.status).toBe('full')
    expect(onSuccessResult.email.expose()).toBe('user@example.com')

    // Wire result is plain object (encoded)
    expect(wireResult.email).toEqual({ value: 'user@example.com', status: 'full' })
    expect(wireResult.email).not.toBeInstanceOf(SensitiveWrapper)
  })

  it('onSuccess has closure access to resources created in input()', async () => {
    const builder = makeBuilder()
    let auditLogEntry: any = null

    const customization = {
      args: {},
      input: async () => {
        const user = { id: 'user-1', name: 'Admin' }

        return {
          ctx: { user },
          args: {},
          hooks: {
            onSuccess: ({ result }: any) => {
              auditLogEntry = { userId: user.id, result }
            }
          }
        }
      }
    }

    const myBuilder = customFnBuilder(builder as any, customization)

    const fn = myBuilder({
      args: { id: z.string() },
      returns: z.object({ name: z.string() }),
      handler: async (_ctx: any, { id }: any) => {
        return { name: `Patient ${id}` }
      }
    }) as any

    await fn({}, { id: 'p-1' })

    expect(auditLogEntry).not.toBeNull()
    expect(auditLogEntry.userId).toBe('user-1')
    expect(auditLogEntry.result.name).toBe('Patient p-1')
  })

  it('onSuccess fires with handler result when no returns schema', async () => {
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
      args: { id: z.string() },
      handler: async (_ctx: any, { id }: any) => {
        return { found: true, id }
      }
    }) as any

    await fn({}, { id: 'test-1' })

    expect(onSuccessResult).not.toBeNull()
    expect(onSuccessResult.found).toBe(true)
    expect(onSuccessResult.id).toBe('test-1')
  })

  it('onSuccess receives augmented ctx (not base ctx)', async () => {
    const builder = makeBuilder()
    let onSuccessCtx: any = null

    const customization = {
      args: {},
      input: async () => ({
        ctx: { user: { id: 'user-1' }, permissions: ['read', 'write'] },
        args: {},
        hooks: {
          onSuccess: ({ ctx: successCtx }: any) => {
            onSuccessCtx = successCtx
          }
        }
      })
    }

    const myBuilder = customFnBuilder(builder as any, customization)

    const fn = myBuilder({
      args: {},
      handler: async (ctx: any) => {
        expect(ctx.user.id).toBe('user-1')
        return 'ok'
      }
    }) as any

    await fn({ baseField: true }, {})

    expect(onSuccessCtx).not.toBeNull()
    expect(onSuccessCtx.user.id).toBe('user-1')
    expect(onSuccessCtx.permissions).toEqual(['read', 'write'])
    expect(onSuccessCtx.baseField).toBe(true)
  })
})
