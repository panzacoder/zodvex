/// <reference types="bun-types" />
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { zx } from '../src/internal/zx'
import { zCustomQuery, zCustomQueryBuilder } from '../src/server'

// Mock Convex query builder
const mockQueryBuilder = (fn: any) => fn

describe('onSuccess convex-helpers convention (top-level)', () => {
  it('calls top-level onSuccess (via zCustomQueryBuilder)', async () => {
    let successCalled = false
    let receivedResult: unknown

    const builder = zCustomQueryBuilder(mockQueryBuilder, {
      args: {},
      input: async () => ({
        ctx: {},
        args: {},
        onSuccess: ({ result }: any) => {
          successCalled = true
          receivedResult = result
        }
      })
    })

    const fn = builder({
      args: z.object({}),
      handler: async () => 'hello'
    })

    await fn.handler({}, {})

    expect(successCalled).toBe(true)
    expect(receivedResult).toBe('hello')
  })

  it('calls top-level onSuccess (via zCustomQuery)', async () => {
    let successCalled = false

    const builder = zCustomQuery(mockQueryBuilder as any, {
      args: {},
      input: async () => ({
        ctx: {},
        args: {},
        onSuccess: () => {
          successCalled = true
        }
      })
    })

    const fn = builder({
      args: z.object({}),
      handler: async () => 'result'
    })

    await fn.handler({}, {})

    expect(successCalled).toBe(true)
  })

  it('calls top-level onSuccess in no-args path', async () => {
    let successCalled = false

    const builder = zCustomQueryBuilder(mockQueryBuilder, {
      args: {},
      input: async () => ({
        ctx: {},
        args: {},
        onSuccess: () => {
          successCalled = true
        }
      })
    })

    const fn = builder({
      handler: async () => 'no-args-result'
    })

    await fn.handler({}, {})

    expect(successCalled).toBe(true)
  })

  it('receives runtime types (not wire format) when returns schema uses codecs', async () => {
    let receivedResult: unknown

    const builder = zCustomQueryBuilder(mockQueryBuilder, {
      args: {},
      input: async () => ({
        ctx: {},
        args: {},
        onSuccess: ({ result }: any) => {
          receivedResult = result
        }
      })
    })

    const now = new Date()
    const fn = builder({
      args: z.object({}),
      returns: z.object({ createdAt: zx.date() }),
      handler: async () => ({ createdAt: now })
    })

    const wireResult = await fn.handler({}, {})

    // Wire result is encoded (Date → number for Convex)
    expect(typeof (wireResult as any).createdAt).toBe('number')

    // onSuccess receives the handler's runtime return value (Date, not number)
    expect((receivedResult as any).createdAt).toBeInstanceOf(Date)
    expect((receivedResult as any).createdAt).toBe(now)
  })

  it('receives runtime types in no-args path with codec returns', async () => {
    let receivedResult: unknown

    const builder = zCustomQueryBuilder(mockQueryBuilder, {
      args: {},
      input: async () => ({
        ctx: {},
        args: {},
        onSuccess: ({ result }: any) => {
          receivedResult = result
        }
      })
    })

    const now = new Date()
    const fn = builder({
      returns: z.object({ createdAt: zx.date() }),
      handler: async () => ({ createdAt: now })
    })

    const wireResult = await fn.handler({}, {})

    // Wire result is encoded
    expect(typeof (wireResult as any).createdAt).toBe('number')

    // onSuccess sees runtime types
    expect((receivedResult as any).createdAt).toBeInstanceOf(Date)
  })
})
