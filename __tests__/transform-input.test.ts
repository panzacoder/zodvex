import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { customCtxWithHooks, zCustomMutationBuilder, zCustomQueryBuilder } from '../src'

const mockMutationBuilder = (fn: any) => fn
const mockQueryBuilder = (fn: any) => fn

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

  it('transforms.input has access to context via closure', async () => {
    let capturedSecret = ''

    const builder = zCustomMutationBuilder(
      mockMutationBuilder,
      customCtxWithHooks(async () => {
        const secretValue = 'security-context-value'
        return {
          transforms: {
            input: (args: unknown) => {
              capturedSecret = secretValue
              return args
            }
          }
        }
      })
    )

    const fn = builder({
      args: z.object({ data: z.string() }),
      handler: async () => 'done'
    })

    await fn.handler({}, { data: 'test' })

    expect(capturedSecret).toBe('security-context-value')
  })

  it('transforms.input runs before handler, hooks.onSuccess runs after', async () => {
    const callOrder: string[] = []

    const builder = zCustomMutationBuilder(
      mockMutationBuilder,
      customCtxWithHooks(async () => ({
        hooks: {
          onSuccess: async () => {
            callOrder.push('hooks.onSuccess')
          }
        },
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
      returns: z.string(),
      handler: async (_ctx, args) => {
        callOrder.push('handler')
        return args.value
      }
    })

    await fn.handler({}, { value: 'test' })

    expect(callOrder).toEqual(['transforms.input', 'handler', 'hooks.onSuccess'])
  })

  it('works with no-args path', async () => {
    const callOrder: string[] = []

    const builder = zCustomMutationBuilder(
      mockMutationBuilder,
      customCtxWithHooks(async () => ({
        transforms: {
          input: (args: unknown) => {
            callOrder.push('transforms.input')
            return { ...(args as object), injected: true }
          }
        }
      }))
    )

    let receivedArgs: any

    // Function without args validation (uses the no-args code path)
    const fn = builder({
      handler: async (_ctx, args) => {
        callOrder.push('handler')
        receivedArgs = args
        return 'done'
      }
    })

    await fn.handler({}, { original: 'value' })

    expect(callOrder).toEqual(['transforms.input', 'handler'])
    expect(receivedArgs).toEqual({ original: 'value', injected: true })
  })

  it('works with both input and output transforms', async () => {
    const callOrder: string[] = []

    const builder = zCustomMutationBuilder(
      mockMutationBuilder,
      customCtxWithHooks(async () => ({
        transforms: {
          input: (args: unknown) => {
            callOrder.push('transforms.input')
            return { ...(args as object), inputTransformed: true }
          },
          output: (result: unknown) => {
            callOrder.push('transforms.output')
            return { ...(result as object), outputTransformed: true }
          }
        }
      }))
    )

    let handlerArgs: any

    const fn = builder({
      args: z.object({ value: z.string() }),
      returns: z.object({ result: z.string() }),
      handler: async (_ctx, args) => {
        callOrder.push('handler')
        handlerArgs = args
        return { result: args.value }
      }
    })

    const result = await fn.handler({}, { value: 'test' })

    expect(callOrder).toEqual(['transforms.input', 'handler', 'transforms.output'])
    expect(handlerArgs).toEqual({ value: 'test', inputTransformed: true })
    expect(result).toMatchObject({ result: 'test', outputTransformed: true })
  })
})

describe('transforms.input with queries', () => {
  it('works with zCustomQueryBuilder', async () => {
    const callOrder: string[] = []

    const builder = zCustomQueryBuilder(
      mockQueryBuilder,
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
      args: z.object({ id: z.string() }),
      handler: async (_ctx, args) => {
        callOrder.push('handler')
        return args.id
      }
    })

    await fn.handler({}, { id: 'test-id' })

    expect(callOrder).toEqual(['transforms.input', 'handler'])
  })
})
