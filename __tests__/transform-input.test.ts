import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { customCtxWithHooks, zCustomMutationBuilder } from '../src'

const mockMutationBuilder = (fn: any) => fn

describe('transforms.input type', () => {
  it('accepts transforms.input in customization', () => {
    // This test verifies the type compiles - if it doesn't, TS will error
    const builder = zCustomMutationBuilder(
      mockMutationBuilder,
      customCtxWithHooks(async () => ({
        transforms: {
          input: (args: unknown) => args
        }
      }))
    )

    expect(builder).toBeDefined()
  })
})

describe('transforms.input hook', () => {
  it('calls transforms.input after validation, before handler', async () => {
    const callOrder: string[] = []

    const builder = zCustomMutationBuilder(
      mockMutationBuilder,
      customCtxWithHooks(async () => ({
        transforms: {
          input: (args: unknown) => {
            callOrder.push('transforms.input')
            return args
          }
        }
      }))
    )

    const fn = builder({
      args: z.object({ value: z.string() }),
      handler: async (_ctx, args) => {
        callOrder.push('handler')
        return args.value
      }
    })

    await fn.handler({}, { value: 'test' })

    expect(callOrder).toEqual(['transforms.input', 'handler'])
  })

  it('transforms.input receives validated args and schema', async () => {
    let receivedArgs: unknown
    let receivedSchema: z.ZodTypeAny | null = null

    const argsSchema = z.object({ name: z.string(), count: z.number() })

    const builder = zCustomMutationBuilder(
      mockMutationBuilder,
      customCtxWithHooks(async () => ({
        transforms: {
          input: (args: unknown, schema: z.ZodTypeAny) => {
            receivedArgs = args
            receivedSchema = schema
            return args
          }
        }
      }))
    )

    const fn = builder({
      args: argsSchema,
      handler: async (_ctx, args) => args.name
    })

    await fn.handler({}, { name: 'test', count: 42 })

    expect(receivedArgs).toEqual({ name: 'test', count: 42 })
    expect(receivedSchema).toBe(argsSchema)
  })

  it('transforms.input can modify args before handler', async () => {
    const builder = zCustomMutationBuilder(
      mockMutationBuilder,
      customCtxWithHooks(async () => ({
        transforms: {
          input: (args: unknown) => ({
            ...(args as object),
            injected: 'from-transform'
          })
        }
      }))
    )

    let receivedArgs: any

    const fn = builder({
      args: z.object({ original: z.string() }),
      handler: async (_ctx, args) => {
        receivedArgs = args
        return 'done'
      }
    })

    await fn.handler({}, { original: 'value' })

    expect(receivedArgs).toEqual({ original: 'value', injected: 'from-transform' })
  })

  it('transforms.input can be async', async () => {
    const builder = zCustomMutationBuilder(
      mockMutationBuilder,
      customCtxWithHooks(async () => ({
        transforms: {
          input: async (args: unknown) => {
            await new Promise(resolve => setTimeout(resolve, 1))
            return { ...(args as object), async: true }
          }
        }
      }))
    )

    let receivedArgs: any

    const fn = builder({
      args: z.object({ value: z.number() }),
      handler: async (_ctx, args) => {
        receivedArgs = args
        return 'done'
      }
    })

    await fn.handler({}, { value: 123 })

    expect(receivedArgs).toEqual({ value: 123, async: true })
  })
})
