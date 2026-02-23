import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { readMeta, type ZodvexFunctionMeta } from '../src/meta'
import { zCustomQuery } from '../src/custom'

// Mock builder that just returns whatever function config it receives
const mockQuery = (fn: any) => fn

describe('__zodvexMeta in customFnBuilder', () => {
  it('attaches metadata with args + returns', () => {
    const builder = zCustomQuery(mockQuery, {})
    const fn = builder({
      args: { name: z.string(), age: z.number() },
      returns: z.string(),
      handler: async (_ctx: any, _args: any) => 'hello'
    })

    const meta = readMeta(fn)
    expect(meta).toBeDefined()
    expect(meta!.type).toBe('function')

    const fmeta = meta as ZodvexFunctionMeta
    expect(fmeta.zodArgs).toBeInstanceOf(z.ZodObject)
    expect(fmeta.zodReturns).toBeInstanceOf(z.ZodString)
  })

  it('attaches metadata with args only (no returns)', () => {
    const builder = zCustomQuery(mockQuery, {})
    const fn = builder({
      args: { email: z.string() },
      handler: async (_ctx: any, _args: any) => 42
    })

    const meta = readMeta(fn)
    expect(meta).toBeDefined()
    expect(meta!.type).toBe('function')

    const fmeta = meta as ZodvexFunctionMeta
    expect(fmeta.zodArgs).toBeInstanceOf(z.ZodObject)
    expect(fmeta.zodReturns).toBeUndefined()
  })

  it('attaches metadata for handler-only (no args, no returns)', () => {
    const builder = zCustomQuery(mockQuery, {})
    const fn = builder(async (_ctx: any) => 'hello')

    const meta = readMeta(fn)
    expect(meta).toBeDefined()
    expect(meta!.type).toBe('function')

    const fmeta = meta as ZodvexFunctionMeta
    expect(fmeta.zodArgs).toBeUndefined()
    expect(fmeta.zodReturns).toBeUndefined()
  })
})
