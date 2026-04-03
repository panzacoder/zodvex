import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { zActionBuilder, zMutationBuilder, zQueryBuilder } from '../src/builders'
import { zCustomQuery } from '../src/custom'
import { readMeta, type ZodvexFunctionMeta } from '../src/meta'
import { $ZodBoolean, $ZodNumber, $ZodObject, $ZodString } from "zod/v4/core";

// Mock builder that just returns whatever function config it receives
const mockBuilder = (fn: any) => fn

describe('__zodvexMeta in customFnBuilder', () => {
  it('attaches metadata with args + returns', () => {
    const builder = zCustomQuery(mockBuilder, {})
    const fn = builder({
      args: { name: z.string(), age: z.number() },
      returns: z.string(),
      handler: async (_ctx: any, _args: any) => 'hello'
    })

    const meta = readMeta(fn)
    expect(meta).toBeDefined()
    expect(meta?.type).toBe('function')

    const fmeta = meta as ZodvexFunctionMeta
    expect(fmeta.zodArgs).toBeInstanceOf($ZodObject)
    expect(fmeta.zodReturns).toBeInstanceOf($ZodString)
  })

  it('attaches metadata with args only (no returns)', () => {
    const builder = zCustomQuery(mockBuilder, {})
    const fn = builder({
      args: { email: z.string() },
      handler: async (_ctx: any, _args: any) => 42
    })

    const meta = readMeta(fn)
    expect(meta).toBeDefined()
    expect(meta?.type).toBe('function')

    const fmeta = meta as ZodvexFunctionMeta
    expect(fmeta.zodArgs).toBeInstanceOf($ZodObject)
    expect(fmeta.zodReturns).toBeUndefined()
  })

  it('attaches metadata for handler-only (no args, no returns)', () => {
    const builder = zCustomQuery(mockBuilder, {})
    const fn = builder(async (_ctx: any) => 'hello')

    const meta = readMeta(fn)
    expect(meta).toBeDefined()
    expect(meta?.type).toBe('function')

    const fmeta = meta as ZodvexFunctionMeta
    expect(fmeta.zodArgs).toBeUndefined()
    expect(fmeta.zodReturns).toBeUndefined()
  })
})

describe('__zodvexMeta in direct builders', () => {
  it('zQueryBuilder with args + returns', () => {
    const zq = zQueryBuilder(mockBuilder)
    const fn = zq({
      args: z.object({ name: z.string() }),
      returns: z.number(),
      handler: async (_ctx: any, _args: any) => 42
    })

    const meta = readMeta(fn)
    expect(meta).toBeDefined()
    expect(meta?.type).toBe('function')

    const fmeta = meta as ZodvexFunctionMeta
    expect(fmeta.zodArgs).toBeInstanceOf($ZodObject)
    expect(fmeta.zodReturns).toBeInstanceOf($ZodNumber)
  })

  it('zMutationBuilder with args only', () => {
    const zm = zMutationBuilder(mockBuilder)
    const fn = zm({
      args: { email: z.string() },
      handler: async (_ctx: any, _args: any) => {
        /* no-op */
      }
    })

    const meta = readMeta(fn)
    expect(meta).toBeDefined()

    const fmeta = meta as ZodvexFunctionMeta
    expect(fmeta.zodArgs).toBeInstanceOf($ZodObject)
    expect(fmeta.zodReturns).toBeUndefined()
  })

  it('zActionBuilder with args + returns', () => {
    const za = zActionBuilder(mockBuilder)
    const fn = za({
      args: z.object({ url: z.string() }),
      returns: z.boolean(),
      handler: async (_ctx: any, _args: any) => true
    })

    const meta = readMeta(fn)
    expect(meta).toBeDefined()

    const fmeta = meta as ZodvexFunctionMeta
    expect(fmeta.zodArgs).toBeInstanceOf($ZodObject)
    expect(fmeta.zodReturns).toBeInstanceOf($ZodBoolean)
  })

  it('args as z.object() preserves the ZodObject instance', () => {
    const argsSchema = z.object({ id: z.string() })
    const zq = zQueryBuilder(mockBuilder)
    const fn = zq({
      args: argsSchema,
      handler: async (_ctx: any, _args: any) => null
    })

    const meta = readMeta(fn) as ZodvexFunctionMeta
    // When args is already a ZodObject, the same instance should be used
    expect(meta.zodArgs).toBe(argsSchema)
  })
})
