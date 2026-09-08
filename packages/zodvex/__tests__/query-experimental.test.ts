import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { $ZodError } from 'zod/v4/core'
import { ZodvexDecodeError } from '../src/internal/boundaryHelpers'

// The subscription boundary is controlled; argument/result codecs run unchanged.
const native = vi.hoisted(() => ({
  state: { status: 'pending' } as any,
  calls: [] as any[],
  failure: undefined as Error | undefined,
  available: true
}))
vi.mock('convex/react', () => ({
  useQuery: () => undefined,
  useMutation: () => async () => undefined,
  get useQuery_experimental() {
    if (!native.available) return undefined
    return (options: any) => {
      native.calls.push(options)
      if (native.failure) throw native.failure
      if (options.args === 'skip') return { status: 'pending' }
      if (native.state.status === 'error' && options.throwOnError) throw native.state.error
      return native.state
    }
  }
}))

import { createZodvexHooks } from '../src/public/react/hooks'

const query = { [Symbol.for('functionName')]: 'tasks:get' } as any
const date = z.codec(z.number(), z.date(), {
  decode: value => new Date(value),
  encode: value => value.getTime()
})
const registry = { 'tasks:get': { args: z.object({ at: date }), returns: date } }

beforeEach(() => {
  native.state = { status: 'pending' }
  native.calls = []
  native.failure = undefined
  native.available = true
})

describe('useQuery_experimental', () => {
  it('encodes decoded arguments and decodes successful wire data', () => {
    native.state = { status: 'success', data: 1234 }
    const hook = createZodvexHooks(registry).useQuery_experimental
    expect(hook({ query, args: { at: new Date(1234) } })).toEqual({
      status: 'success',
      data: new Date(1234)
    })
    expect(native.calls[0].args).toEqual({ at: 1234 })
  })

  it('keeps pending and skipped queries out of the decoder', () => {
    const hook = createZodvexHooks(registry).useQuery_experimental
    expect(hook({ query, args: { at: new Date(1234) } })).toEqual({ status: 'pending' })
    native.state = { status: 'success', data: 'invalid date' }
    expect(hook({ query, args: 'skip' })).toEqual({ status: 'pending' })
    expect(native.calls[1].args).toBe('skip')
  })

  it('passes through missing schemas and retains null success data', () => {
    const hook = createZodvexHooks({}).useQuery_experimental
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined)
    native.state = { status: 'success', data: null }
    expect(hook({ query, args: {} })).toEqual({ status: 'success', data: null })
    expect(native.calls[0].args).toEqual({})
    debug.mockRestore()
  })

  it('preserves native error identity and delegates throwOnError', () => {
    const error = new Error('server failure')
    native.state = { status: 'error', error }
    const hook = createZodvexHooks(registry).useQuery_experimental
    expect(hook({ query, args: { at: new Date() } })).toEqual({ status: 'error', error })
    expect(() => hook({ query, args: { at: new Date() }, throwOnError: true })).toThrow(error)
  })

  it('does not convert synchronous native hook failures into query states', () => {
    native.failure = new Error('missing provider')
    const hook = createZodvexHooks(registry).useQuery_experimental
    expect(() => hook({ query, args: { at: new Date() } })).toThrow(native.failure)
  })

  it('uses strict decoding by default and preserves the Zod error as cause', () => {
    native.state = { status: 'success', data: 'invalid date' }
    const hook = createZodvexHooks(registry).useQuery_experimental
    const state = hook({ query, args: { at: new Date() } })
    expect(state.status).toBe('error')
    if (state.status !== 'error') throw new Error('Expected codec error')
    expect(state.error).toBeInstanceOf(Error)
    expect(state.error.cause).toBeInstanceOf(ZodvexDecodeError)
    expect(() => hook({ query, args: { at: new Date() }, throwOnError: true })).toThrow(Error)
  })

  it('honors explicit warn decoding even with throwOnError enabled', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    native.state = { status: 'success', data: 'invalid date' }
    const hook = createZodvexHooks(registry, { onDecodeError: 'warn' }).useQuery_experimental
    expect(hook({ query, args: { at: new Date() }, throwOnError: true })).toEqual(native.state)
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it('still invokes the native hook on encoding failure, then recovers and skips', () => {
    const hook = createZodvexHooks(registry).useQuery_experimental
    const failed = hook({ query, args: { at: 'invalid' } })
    expect(failed.status).toBe('error')
    if (failed.status !== 'error') throw new Error('Expected codec error')
    expect(failed.error).toBeInstanceOf(Error)
    expect(failed.error.cause).toBeInstanceOf($ZodError)
    native.state = { status: 'success', data: 1234 }
    expect(hook({ query, args: { at: new Date(1234) } }).status).toBe('success')
    expect(hook({ query, args: 'skip' }).status).toBe('pending')
    expect(native.calls.map(call => call.args)).toEqual(['skip', { at: 1234 }, 'skip'])
    expect(() => hook({ query, args: { at: 'invalid' }, throwOnError: true })).toThrow(Error)
    expect(native.calls[3].args).toBe('skip')
  })

  it.each([
    undefined,
    null,
    'sensitive input',
    new Error('custom failure')
  ])('normalizes custom codec exceptions without losing their cause (%s)', thrown => {
    const throwing = z.codec(z.number(), z.date(), {
      decode: () => {
        throw thrown
      },
      encode: () => {
        throw thrown
      }
    })
    for (const stage of ['args', 'returns'] as const) {
      const hook = createZodvexHooks({ 'tasks:get': { [stage]: throwing } }).useQuery_experimental
      native.state = { status: 'success', data: 1234 }
      const state = hook({ query, args: new Date() })
      expect(state.status).toBe('error')
      if (state.status !== 'error') throw new Error('Expected codec error')
      expect(state.error).toBeInstanceOf(Error)
      if (thrown instanceof Error) expect(state.error).toBe(thrown)
      else {
        expect(state.error.cause).toBe(thrown)
        expect(state.error.message).not.toContain('sensitive input')
      }
    }
  })

  it('requires the newer SDK only when the experimental hook is invoked', () => {
    native.available = false
    const hooks = createZodvexHooks(registry)
    expect(hooks.useZodQuery(query, 'skip')).toBeUndefined()
    expect(() => hooks.useQuery_experimental({ query, args: 'skip' })).toThrow(/Convex.*1\.37/)
  })
})
