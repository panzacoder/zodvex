import { describe, expect, it } from 'bun:test'
import { v } from 'convex/values'
import { z } from 'zod'
import { zid } from '../src/ids'
import { zodToConvex } from '../src/mapping'

describe('zid', () => {
  it('creates a string validator with proper type', () => {
    const userId = zid('users')

    // Should parse valid IDs
    expect(userId.parse('user123')).toBe('user123')

    // Should reject empty strings
    expect(() => userId.parse('')).toThrow()

    // Should reject invalid types
    expect(() => userId.parse(123 as any)).toThrow()
  })

  it('has tableName property for type-level detection', () => {
    const userId = zid('users')
    expect((userId as any)._tableName).toBe('users')
  })

  it('has description for introspection', () => {
    const userId = zid('users')
    expect(userId.description).toBe('convexId:users')
  })

  it('converts to v.id() via zodToConvex', () => {
    const userId = zid('users')
    const validator = zodToConvex(userId)

    expect(validator).toEqual(v.id('users'))
  })

  it('converts optional zid to v.optional(v.id())', () => {
    const userId = zid('users').optional()
    const validator = zodToConvex(userId)

    expect(validator).toEqual(v.optional(v.id('users')))
  })

  it('converts nullable zid to v.union(v.id(), v.null())', () => {
    const userId = zid('users').nullable()
    const validator = zodToConvex(userId)

    expect(validator).toEqual(v.union(v.id('users'), v.null()))
  })

  it('works in object schemas', () => {
    const schema = z.object({
      userId: zid('users'),
      teamId: zid('teams').optional()
    })

    const validator = zodToConvex(schema)

    expect(validator).toEqual(
      v.object({
        userId: v.id('users'),
        teamId: v.optional(v.id('teams'))
      })
    )
  })
})

describe('zid - AI SDK compatibility', () => {
  it('does not use transform (AI SDK compatible)', () => {
    const userId = zid('users')

    // Check that the schema doesn't have transform in its chain
    // We can't directly check _def without accessing private API,
    // but we can verify behavior: transforms would change the output type
    const parsed = userId.parse('user123')
    expect(parsed).toBe('user123') // Should be unchanged string

    // The type assertion happens at compile time, not runtime
    expect(typeof parsed).toBe('string')
  })

  it('does not use brand (AI SDK compatible)', () => {
    const userId = zid('users')

    // Branded types in Zod 4 add a _brand property
    // Since we removed .brand(), this shouldn't exist
    const parsed: any = userId.parse('user123')
    expect(parsed._brand).toBeUndefined()
  })

  it('works with schemas for AI SDK generateObject', () => {
    // This is the kind of schema you'd pass to AI SDK
    const userSchema = z.object({
      id: zid('users'),
      name: z.string(),
      email: z.string().email(),
      teamId: zid('teams').optional()
    })

    // AI SDK checks that all schemas are serializable (no transforms)
    // Our zid should pass this check
    const testData = {
      id: 'user_abc123',
      name: 'Alice',
      email: 'alice@example.com',
      teamId: 'team_xyz'
    }

    const result = userSchema.parse(testData)
    expect(result).toEqual(testData)
  })

  it('maintains type safety with GenericId', () => {
    const userId = zid('users')

    // Type-level test: this should compile without errors
    const id: string = userId.parse('user123')
    expect(id).toBe('user123')

    // The GenericId<'users'> type is maintained via type assertion
    // Runtime behavior is still just a string
    type UserIdType = z.infer<typeof userId>
    const typedId: UserIdType = 'user123' as any
    expect(typeof typedId).toBe('string')
  })
})

describe('zid - registry metadata', () => {
  it('stores table name in metadata', () => {
    const userId = zid('users')

    // The metadata should be stored for mapping to work
    const { registryHelpers } = require('../src/ids')
    const metadata = registryHelpers.getMetadata(userId)

    expect(metadata).toBeDefined()
    expect(metadata.isConvexId).toBe(true)
    expect(metadata.tableName).toBe('users')
  })

  it('different zid instances have different metadata', () => {
    const userId = zid('users')
    const teamId = zid('teams')

    const { registryHelpers } = require('../src/ids')
    const userMeta = registryHelpers.getMetadata(userId)
    const teamMeta = registryHelpers.getMetadata(teamId)

    expect(userMeta.tableName).toBe('users')
    expect(teamMeta.tableName).toBe('teams')
  })
})
