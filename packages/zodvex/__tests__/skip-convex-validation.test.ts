/**
 * Tests for Issue #25: skipConvexValidation should still run Zod validation
 *
 * The skipConvexValidation flag should:
 * - Skip Convex's automatic validation (for performance)
 * - Still run Zod validation (for schema enforcement, stripping unknown fields, etc.)
 */

import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { customFnBuilder } from '../src/custom'

// Mock builder that captures what was passed to it
function createMockBuilder() {
  let capturedArgs: any = null
  const builder = (fn: any) => {
    capturedArgs = fn
    return fn
  }
  return {
    builder,
    getCaptured: () => capturedArgs
  }
}

// Helper to simulate calling the handler
async function callHandler(registered: any, ctx: any, args: any) {
  return registered.handler(ctx, args)
}

describe('skipConvexValidation', () => {
  describe('args validation', () => {
    it('should validate args with Zod when skipConvexValidation is true', async () => {
      const { builder } = createMockBuilder()
      const customBuilder = customFnBuilder(builder, {})

      const argsSchema = z.object({
        name: z.string().min(1),
        age: z.number().min(0)
      })

      const registered = customBuilder({
        args: argsSchema,
        skipConvexValidation: true,
        handler: async (_ctx: any, args: { name: string; age: number }) => {
          return { received: args }
        }
      })

      // Valid args should work
      const result = await callHandler(registered, {}, { name: 'Alice', age: 30 })
      expect(result).toEqual({ received: { name: 'Alice', age: 30 } })

      // Invalid args should throw Zod error
      await expect(callHandler(registered, {}, { name: '', age: 30 })).rejects.toThrow()

      // Invalid type should throw Zod error
      await expect(callHandler(registered, {}, { name: 'Bob', age: 'thirty' })).rejects.toThrow()
    })

    it('should validate args with Zod when skipConvexValidation is false', async () => {
      const { builder } = createMockBuilder()
      const customBuilder = customFnBuilder(builder, {})

      const argsSchema = z.object({
        email: z.string().email()
      })

      const registered = customBuilder({
        args: argsSchema,
        skipConvexValidation: false,
        handler: async (_ctx: any, args: { email: string }) => {
          return args.email
        }
      })

      // Valid args should work
      const result = await callHandler(registered, {}, { email: 'test@example.com' })
      expect(result).toBe('test@example.com')

      // Invalid email should throw Zod error
      await expect(callHandler(registered, {}, { email: 'not-an-email' })).rejects.toThrow()
    })

    it('should strip unknown fields with Zod when skipConvexValidation is true', async () => {
      const { builder } = createMockBuilder()
      const customBuilder = customFnBuilder(builder, {})

      const argsSchema = z.object({
        keep: z.string()
      })

      const registered = customBuilder({
        args: argsSchema,
        skipConvexValidation: true,
        handler: async (_ctx: any, args: { keep: string }) => {
          return args
        }
      })

      // Zod's default is to strip unknown fields
      const result = await callHandler(registered, {}, { keep: 'value', extra: 'ignored' })
      expect(result).toEqual({ keep: 'value' })
      expect(result).not.toHaveProperty('extra')
    })
  })

  describe('returns validation', () => {
    it('should validate returns with Zod when skipConvexValidation is true', async () => {
      const { builder } = createMockBuilder()
      const customBuilder = customFnBuilder(builder, {})

      const returnsSchema = z.object({
        id: z.string(),
        count: z.number()
      })

      const registered = customBuilder({
        args: z.object({}),
        returns: returnsSchema,
        skipConvexValidation: true,
        handler: async () => {
          return { id: '123', count: 5 }
        }
      })

      const result = await callHandler(registered, {}, {})
      expect(result).toEqual({ id: '123', count: 5 })
    })

    it('should throw on invalid returns when skipConvexValidation is true', async () => {
      const { builder } = createMockBuilder()
      const customBuilder = customFnBuilder(builder, {})

      const returnsSchema = z.object({
        id: z.string(),
        count: z.number()
      })

      const registered = customBuilder({
        args: z.object({}),
        returns: returnsSchema,
        skipConvexValidation: true,
        handler: async () => {
          // Return invalid type for count
          return { id: '123', count: 'not-a-number' } as any
        }
      })

      await expect(callHandler(registered, {}, {})).rejects.toThrow()
    })
  })

  describe('Convex validator generation', () => {
    it('should not generate Convex args validators when skipConvexValidation is true', () => {
      const { builder, getCaptured } = createMockBuilder()
      const customBuilder = customFnBuilder(builder, {})

      customBuilder({
        args: z.object({
          name: z.string()
        }),
        skipConvexValidation: true,
        handler: async () => {
          // intentionally empty
        }
      })

      const captured = getCaptured()
      // When skipConvexValidation is true, args should be empty (just inputArgs from customization)
      expect(captured.args).toEqual({})
    })

    it('should generate Convex args validators when skipConvexValidation is false', () => {
      const { builder, getCaptured } = createMockBuilder()
      const customBuilder = customFnBuilder(builder, {})

      customBuilder({
        args: z.object({
          name: z.string()
        }),
        skipConvexValidation: false,
        handler: async () => {
          // intentionally empty
        }
      })

      const captured = getCaptured()
      // When skipConvexValidation is false, args should contain the Convex validator
      expect(captured.args).toHaveProperty('name')
    })

    it('should not generate Convex returns validator when skipConvexValidation is true', () => {
      const { builder, getCaptured } = createMockBuilder()
      const customBuilder = customFnBuilder(builder, {})

      customBuilder({
        args: z.object({}),
        returns: z.object({ id: z.string() }),
        skipConvexValidation: true,
        handler: async () => ({ id: '123' })
      })

      const captured = getCaptured()
      expect(captured.returns).toBeUndefined()
    })

    it('should generate Convex returns validator when skipConvexValidation is false', () => {
      const { builder, getCaptured } = createMockBuilder()
      const customBuilder = customFnBuilder(builder, {})

      customBuilder({
        args: z.object({}),
        returns: z.object({ id: z.string() }),
        skipConvexValidation: false,
        handler: async () => ({ id: '123' })
      })

      const captured = getCaptured()
      expect(captured.returns).toBeDefined()
    })
  })

  describe('edge cases', () => {
    it('should handle raw shape objects as args', async () => {
      const { builder } = createMockBuilder()
      const customBuilder = customFnBuilder(builder, {})

      const registered = customBuilder({
        args: {
          name: z.string().min(1)
        },
        skipConvexValidation: true,
        handler: async (_ctx: any, args: { name: string }) => args.name
      })

      const result = await callHandler(registered, {}, { name: 'Test' })
      expect(result).toBe('Test')

      // Should still validate
      await expect(callHandler(registered, {}, { name: '' })).rejects.toThrow()
    })

    it('should handle no args with skipConvexValidation', async () => {
      const { builder } = createMockBuilder()
      const customBuilder = customFnBuilder(builder, {})

      const registered = customBuilder({
        returns: z.string(),
        skipConvexValidation: true,
        handler: async () => 'hello'
      })

      const result = await callHandler(registered, {}, {})
      expect(result).toBe('hello')
    })
  })
})
