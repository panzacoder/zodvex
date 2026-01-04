/**
 * Tests for JSON Schema support (Issue #22: AI SDK compatibility)
 *
 * zodvex types like zid use transforms which are "unrepresentable" in JSON Schema.
 * This module provides overrides to make them work with AI SDKs and other tools
 * that use JSON Schema for validation.
 */

import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { zid } from '../src/ids'
import {
  composeOverrides,
  getZidTableName,
  isZidSchema,
  toJSONSchema,
  zodvexJSONSchemaOverride
} from '../src/registry'

describe('isZidSchema', () => {
  it('should return true for zid schemas', () => {
    const userIdSchema = zid('users')
    expect(isZidSchema(userIdSchema)).toBe(true)
  })

  it('should return false for regular string schemas', () => {
    const stringSchema = z.string()
    expect(isZidSchema(stringSchema)).toBe(false)
  })

  it('should return false for schemas with unrelated descriptions', () => {
    const describedSchema = z.string().describe('some description')
    expect(isZidSchema(describedSchema)).toBe(false)
  })
})

describe('getZidTableName', () => {
  it('should extract table name from zid schema', () => {
    const userIdSchema = zid('users')
    expect(getZidTableName(userIdSchema)).toBe('users')
  })

  it('should extract table name for different tables', () => {
    const postIdSchema = zid('posts')
    expect(getZidTableName(postIdSchema)).toBe('posts')

    const commentIdSchema = zid('comments')
    expect(getZidTableName(commentIdSchema)).toBe('comments')
  })

  it('should return undefined for non-zid schemas', () => {
    const stringSchema = z.string()
    expect(getZidTableName(stringSchema)).toBeUndefined()
  })
})

describe('zodvexJSONSchemaOverride', () => {
  it('should convert zid to string type', () => {
    const userIdSchema = zid('users')
    const jsonSchema: Record<string, any> = {}

    zodvexJSONSchemaOverride({ zodSchema: userIdSchema, jsonSchema })

    expect(jsonSchema.type).toBe('string')
    expect(jsonSchema.format).toBe('convex-id:users')
  })

  it('should convert z.date() to string with date-time format', () => {
    const dateSchema = z.date()
    const jsonSchema: Record<string, any> = {}

    zodvexJSONSchemaOverride({ zodSchema: dateSchema, jsonSchema })

    expect(jsonSchema.type).toBe('string')
    expect(jsonSchema.format).toBe('date-time')
  })

  it('should not modify regular string schemas', () => {
    const stringSchema = z.string()
    const jsonSchema: Record<string, any> = { type: 'string' }

    zodvexJSONSchemaOverride({ zodSchema: stringSchema, jsonSchema })

    expect(jsonSchema).toEqual({ type: 'string' })
  })

  it('should preserve existing properties when overriding', () => {
    const userIdSchema = zid('users')
    // User overrides might set properties before zodvex runs
    const jsonSchema: Record<string, any> = { customProp: 'preserved' }

    zodvexJSONSchemaOverride({ zodSchema: userIdSchema, jsonSchema })

    // Our properties are added
    expect(jsonSchema.type).toBe('string')
    expect(jsonSchema.format).toBe('convex-id:users')
    // Existing properties are preserved
    expect(jsonSchema.customProp).toBe('preserved')
  })
})

describe('toJSONSchema', () => {
  it('should convert simple object with zid', () => {
    const schema = z.object({
      userId: zid('users'),
      name: z.string()
    })

    const jsonSchema = toJSONSchema(schema)

    expect(jsonSchema.type).toBe('object')
    expect(jsonSchema.properties.userId.type).toBe('string')
    expect(jsonSchema.properties.userId.format).toBe('convex-id:users')
    expect(jsonSchema.properties.name.type).toBe('string')
  })

  it('should handle multiple zid fields', () => {
    const schema = z.object({
      authorId: zid('users'),
      postId: zid('posts'),
      content: z.string()
    })

    const jsonSchema = toJSONSchema(schema)

    expect(jsonSchema.properties.authorId.type).toBe('string')
    expect(jsonSchema.properties.authorId.format).toBe('convex-id:users')
    expect(jsonSchema.properties.postId.type).toBe('string')
    expect(jsonSchema.properties.postId.format).toBe('convex-id:posts')
  })

  it('should handle nested objects with zid', () => {
    const schema = z.object({
      author: z.object({
        id: zid('users'),
        name: z.string()
      }),
      title: z.string()
    })

    const jsonSchema = toJSONSchema(schema)

    expect(jsonSchema.properties.author.properties.id.type).toBe('string')
    expect(jsonSchema.properties.author.properties.id.format).toBe('convex-id:users')
  })

  it('should handle arrays of zid', () => {
    const schema = z.object({
      userIds: z.array(zid('users'))
    })

    const jsonSchema = toJSONSchema(schema)

    expect(jsonSchema.properties.userIds.type).toBe('array')
    expect(jsonSchema.properties.userIds.items.type).toBe('string')
    expect(jsonSchema.properties.userIds.items.format).toBe('convex-id:users')
  })

  it('should handle optional zid', () => {
    const schema = z.object({
      userId: zid('users').optional(),
      name: z.string()
    })

    const jsonSchema = toJSONSchema(schema)

    // Optional fields shouldn't be in required
    expect(jsonSchema.required).not.toContain('userId')
    expect(jsonSchema.required).toContain('name')
  })

  it('should handle z.date() fields', () => {
    const schema = z.object({
      createdAt: z.date(),
      name: z.string()
    })

    const jsonSchema = toJSONSchema(schema)

    expect(jsonSchema.properties.createdAt.type).toBe('string')
    expect(jsonSchema.properties.createdAt.format).toBe('date-time')
  })

  it('should allow custom override to be chained', () => {
    const schema = z.object({
      userId: zid('users'),
      email: z.string().email()
    })

    let customOverrideCalled = false

    const jsonSchema = toJSONSchema(schema, {
      override: ctx => {
        customOverrideCalled = true
        // User's custom override runs after zodvex override
        if (ctx.zodSchema.description?.includes('email')) {
          ctx.jsonSchema.customProp = true
        }
      }
    })

    expect(customOverrideCalled).toBe(true)
    // zodvex override still applied
    expect(jsonSchema.properties.userId.type).toBe('string')
  })

  it('should not throw for transform schemas', () => {
    const schema = z.object({
      userId: zid('users'),
      count: z.number()
    })

    // Should not throw - unrepresentable defaults to 'any'
    expect(() => toJSONSchema(schema)).not.toThrow()
  })

  it('should work with unrepresentable set to throw since zid uses refinement not transform', () => {
    // zid uses refinement (not transform), so it's representable in JSON Schema
    const schema = z.object({
      userId: zid('users')
    })

    // Should not throw - zid is now compatible with strict mode
    const jsonSchema = toJSONSchema(schema, { unrepresentable: 'throw' })
    expect(jsonSchema.properties.userId.type).toBe('string')
  })
})

describe('composeOverrides', () => {
  it('should compose multiple overrides in order', () => {
    const calls: string[] = []

    const override1 = () => {
      calls.push('first')
    }
    const override2 = () => {
      calls.push('second')
    }

    const composed = composeOverrides(override1, override2)
    composed({ zodSchema: z.string(), jsonSchema: {} })

    expect(calls).toEqual(['first', 'second'])
  })

  it('should handle undefined overrides gracefully', () => {
    const calls: string[] = []

    const override1 = () => {
      calls.push('first')
    }

    const composed = composeOverrides(override1, undefined, zodvexJSONSchemaOverride)
    // Should not throw
    expect(() => composed({ zodSchema: z.string(), jsonSchema: {} })).not.toThrow()
    expect(calls).toEqual(['first'])
  })

  it('should allow user override to run before zodvex and preserve properties', () => {
    const userIdSchema = zid('users')
    let userOverrideRan = false

    // User's override runs first and modifies the schema
    const userOverride = (ctx: any) => {
      if (isZidSchema(ctx.zodSchema)) {
        userOverrideRan = true
        // User sets a custom property before zodvex runs
        ctx.jsonSchema.customProp = 'user-set'
      }
    }

    const composed = composeOverrides(userOverride, zodvexJSONSchemaOverride)
    const jsonSchema: Record<string, any> = {}
    composed({ zodSchema: userIdSchema, jsonSchema })

    expect(userOverrideRan).toBe(true)
    // zodvex override ran after and set type/format
    expect(jsonSchema.type).toBe('string')
    expect(jsonSchema.format).toBe('convex-id:users')
    // User's custom prop is preserved - zodvex doesn't clear existing properties
    expect(jsonSchema.customProp).toBe('user-set')
  })

  it('should allow user override to run after zodvex and extend', () => {
    const userIdSchema = zid('users')

    // User's override runs after zodvex and adds to the schema
    const userOverride = (ctx: any) => {
      if (ctx.jsonSchema.format?.startsWith('convex-id:')) {
        ctx.jsonSchema.description = 'A Convex document ID'
      }
    }

    const composed = composeOverrides(zodvexJSONSchemaOverride, userOverride)
    const jsonSchema: Record<string, any> = {}
    composed({ zodSchema: userIdSchema, jsonSchema })

    expect(jsonSchema.type).toBe('string')
    expect(jsonSchema.format).toBe('convex-id:users')
    expect(jsonSchema.description).toBe('A Convex document ID')
  })
})

describe('AI SDK compatibility', () => {
  it('should show what format/description the LLM receives', () => {
    // This test documents what the LLM actually sees
    const schema = z.object({
      userId: zid('users')
    })

    const jsonSchema = toJSONSchema(schema)

    // The LLM receives this structure:
    // - type: "string" - must output a string
    // - format: "convex-id:users" - hint about the format
    // - description comes from the Zod .describe() which we set
    expect(jsonSchema.properties.userId).toEqual({
      type: 'string',
      format: 'convex-id:users',
      description: 'convexId:users' // From zid's .describe()
    })
  })

  it('should produce valid JSON Schema for AI SDK use case', () => {
    // This is the example from Issue #22
    const schema = z.object({
      userId: zid('users'),
      email: z.string().email(),
      preferences: z.object({
        theme: z.enum(['light', 'dark']),
        notifications: z.boolean()
      })
    })

    const jsonSchema = toJSONSchema(schema)

    // Verify it's a valid JSON Schema structure
    expect(jsonSchema.$schema).toMatch(/json-schema/)
    expect(jsonSchema.type).toBe('object')
    expect(jsonSchema.properties).toBeDefined()

    // zid converted to string
    expect(jsonSchema.properties.userId.type).toBe('string')

    // Regular types work as expected
    expect(jsonSchema.properties.email.type).toBe('string')
    expect(jsonSchema.properties.preferences.type).toBe('object')
    expect(jsonSchema.properties.preferences.properties.theme.enum).toEqual(['light', 'dark'])
  })
})
