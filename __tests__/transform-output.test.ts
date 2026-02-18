/// <reference types="bun-types" />
import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { customCtxWithHooks, zCustomQueryBuilder } from '../src'

// Mock Convex query builder
const mockQueryBuilder = (fn: any) => fn

describe('transforms.output hook', () => {
  it('calls transforms.output before validation (to convert internal → wire format)', async () => {
    const callOrder: string[] = []

    const builder = zCustomQueryBuilder(
      mockQueryBuilder,
      customCtxWithHooks(async () => ({
        transforms: {
          output: (result: unknown) => {
            callOrder.push('transforms.output')
            return result
          }
        }
      }))
    )

    const fn = builder({
      args: z.object({}),
      returns: z.string(),
      handler: async () => {
        callOrder.push('handler')
        return 'result'
      }
    })

    await fn.handler({}, {})

    expect(callOrder).toEqual(['handler', 'transforms.output'])
  })

  it('transforms.output receives validated result and schema', async () => {
    let receivedResult: unknown
    let receivedSchema: z.ZodTypeAny | null = null

    const returnsSchema = z.object({ value: z.number() })

    const builder = zCustomQueryBuilder(
      mockQueryBuilder,
      customCtxWithHooks(async () => ({
        transforms: {
          output: (result: unknown, schema: z.ZodTypeAny) => {
            receivedResult = result
            receivedSchema = schema
            return result
          }
        }
      }))
    )

    const fn = builder({
      args: z.object({}),
      returns: returnsSchema,
      handler: async () => ({ value: 123 })
    })

    await fn.handler({}, {})

    expect(receivedResult).toEqual({ value: 123 })
    expect(receivedSchema).toBe(returnsSchema)
  })

  it('transforms.output can modify the result', async () => {
    const builder = zCustomQueryBuilder(
      mockQueryBuilder,
      customCtxWithHooks(async () => ({
        transforms: {
          output: (result: unknown) => ({
            ...(result as object),
            transformed: true
          })
        }
      }))
    )

    const fn = builder({
      args: z.object({}),
      // Schema must include properties that transform adds (transform runs BEFORE validation)
      returns: z.object({ value: z.number(), transformed: z.boolean() }),
      handler: async () => ({ value: 42 })
    })

    const result = await fn.handler({}, {})

    expect(result).toMatchObject({ value: 42, transformed: true })
  })

  it('transforms.output has access to context via closure', async () => {
    let capturedValue = ''

    const builder = zCustomQueryBuilder(
      mockQueryBuilder,
      customCtxWithHooks(async () => {
        const secretValue = 'captured-in-closure'
        return {
          transforms: {
            output: (result: unknown) => {
              capturedValue = secretValue
              return result
            }
          }
        }
      })
    )

    const fn = builder({
      args: z.object({}),
      returns: z.string(),
      handler: async () => 'test'
    })

    await fn.handler({}, {})

    expect(capturedValue).toBe('captured-in-closure')
  })

  it('transforms.output is called before validation and hooks.onSuccess', async () => {
    const callOrder: string[] = []

    const builder = zCustomQueryBuilder(
      mockQueryBuilder,
      customCtxWithHooks(async () => ({
        hooks: {
          onSuccess: async () => {
            callOrder.push('hooks.onSuccess')
          }
        },
        transforms: {
          output: (result: unknown) => {
            callOrder.push('transforms.output')
            return result
          }
        }
      }))
    )

    const fn = builder({
      args: z.object({}),
      returns: z.string(),
      handler: async () => {
        callOrder.push('handler')
        return 'result'
      }
    })

    await fn.handler({}, {})

    // onSuccess runs BEFORE encode (sees runtime types like Date, SensitiveWrapper)
    // transforms.output runs BEFORE validation (converts internal → wire format)
    expect(callOrder).toEqual(['handler', 'hooks.onSuccess', 'transforms.output'])
  })

  it('works without transforms (backward compatible)', async () => {
    const builder = zCustomQueryBuilder(
      mockQueryBuilder,
      customCtxWithHooks(async () => ({
        ctx: { extra: 'value' }
      }))
    )

    const fn = builder({
      args: z.object({ input: z.string() }),
      returns: z.string(),
      handler: async (_ctx, args) => `Hello, ${args.input}!`
    })

    const result = await fn.handler({}, { input: 'World' })

    expect(result).toBe('Hello, World!')
  })

  it('transforms.output can be async', async () => {
    const builder = zCustomQueryBuilder(
      mockQueryBuilder,
      customCtxWithHooks(async () => ({
        transforms: {
          output: async (result: unknown) => {
            await new Promise(resolve => setTimeout(resolve, 1))
            return { ...(result as object), async: true }
          }
        }
      }))
    )

    const fn = builder({
      args: z.object({}),
      // Schema must include properties that transform adds (transform runs BEFORE validation)
      returns: z.object({ value: z.number(), async: z.boolean() }),
      handler: async () => ({ value: 1 })
    })

    const result = await fn.handler({}, {})

    expect(result).toMatchObject({ value: 1, async: true })
  })

  it('works with no-args path', async () => {
    const callOrder: string[] = []

    const builder = zCustomQueryBuilder(
      mockQueryBuilder,
      customCtxWithHooks(async () => ({
        transforms: {
          output: (result: unknown) => {
            callOrder.push('transforms.output')
            return { ...(result as object), transformed: true }
          }
        }
      }))
    )

    // Function without args validation (uses the no-args code path)
    const fn = builder({
      // Schema must include properties that transform adds (transform runs BEFORE validation)
      returns: z.object({ value: z.number(), transformed: z.boolean() }),
      handler: async () => {
        callOrder.push('handler')
        return { value: 42 }
      }
    })

    const result = await fn.handler({}, {})

    expect(callOrder).toEqual(['handler', 'transforms.output'])
    expect(result).toMatchObject({ value: 42, transformed: true })
  })
})
