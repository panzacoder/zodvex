/// <reference types="bun-types" />
import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { zCustomQuery, zCustomQueryBuilder } from '../src'

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
})
