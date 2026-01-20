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
