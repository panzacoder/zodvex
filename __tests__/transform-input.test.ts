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
})
