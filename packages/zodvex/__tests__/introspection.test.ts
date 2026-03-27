import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import {
  getBaseType,
  getDefault,
  getTableName,
  hasDefault,
  introspect,
  isConvexId,
  isNullable,
  isOptional
} from '../src/introspection'
import { zid } from '../src/ids'
import { zx } from '../src/zx'

describe('introspect', () => {
  describe('primitive types', () => {
    it('detects string', () => {
      const info = introspect(z.string())
      expect(info.baseType).toBe('string')
      expect(info.isOptional).toBe(false)
      expect(info.isNullable).toBe(false)
      expect(info.hasDefault).toBe(false)
      expect(info.isConvexId).toBe(false)
    })

    it('detects number', () => {
      expect(introspect(z.number()).baseType).toBe('number')
    })

    it('detects bigint', () => {
      expect(introspect(z.bigint()).baseType).toBe('bigint')
    })

    it('detects boolean', () => {
      expect(introspect(z.boolean()).baseType).toBe('boolean')
    })

    it('detects null', () => {
      expect(introspect(z.null()).baseType).toBe('null')
    })

    it('detects date', () => {
      expect(introspect(z.date()).baseType).toBe('date')
    })
  })

  describe('wrapper types', () => {
    it('detects optional', () => {
      const info = introspect(z.string().optional())
      expect(info.baseType).toBe('string')
      expect(info.isOptional).toBe(true)
      expect(info.isNullable).toBe(false)
    })

    it('detects nullable', () => {
      const info = introspect(z.string().nullable())
      expect(info.baseType).toBe('string')
      expect(info.isOptional).toBe(false)
      expect(info.isNullable).toBe(true)
    })

    it('detects optional + nullable', () => {
      const info = introspect(z.string().optional().nullable())
      expect(info.baseType).toBe('string')
      expect(info.isOptional).toBe(true)
      expect(info.isNullable).toBe(true)
    })

    it('detects nullable + optional', () => {
      const info = introspect(z.string().nullable().optional())
      expect(info.baseType).toBe('string')
      expect(info.isOptional).toBe(true)
      expect(info.isNullable).toBe(true)
    })

    it('detects readonly', () => {
      const info = introspect(z.string().readonly())
      expect(info.baseType).toBe('string')
      expect(info.isReadonly).toBe(true)
    })
  })

  describe('default values', () => {
    it('detects string default', () => {
      const info = introspect(z.string().default('hello'))
      expect(info.hasDefault).toBe(true)
      expect(info.defaultValue).toBe('hello')
      expect(info.baseType).toBe('string')
    })

    it('detects number default', () => {
      const info = introspect(z.number().default(42))
      expect(info.hasDefault).toBe(true)
      expect(info.defaultValue).toBe(42)
    })

    it('detects boolean default', () => {
      const info = introspect(z.boolean().default(false))
      expect(info.hasDefault).toBe(true)
      expect(info.defaultValue).toBe(false)
    })

    it('handles optional with default', () => {
      const info = introspect(z.string().optional().default('fallback'))
      expect(info.hasDefault).toBe(true)
      expect(info.defaultValue).toBe('fallback')
      expect(info.isOptional).toBe(true)
    })
  })

  describe('Convex ID detection', () => {
    it('detects zid', () => {
      const info = introspect(zid('users'))
      expect(info.isConvexId).toBe(true)
      expect(info.tableName).toBe('users')
      expect(info.baseType).toBe('string')
    })

    it('detects zx.id', () => {
      const info = introspect(zx.id('teams'))
      expect(info.isConvexId).toBe(true)
      expect(info.tableName).toBe('teams')
    })

    it('detects optional zid', () => {
      const info = introspect(zid('users').optional())
      expect(info.isConvexId).toBe(true)
      expect(info.tableName).toBe('users')
      expect(info.isOptional).toBe(true)
    })

    it('detects nullable zid', () => {
      const info = introspect(zid('users').nullable())
      expect(info.isConvexId).toBe(true)
      expect(info.tableName).toBe('users')
      expect(info.isNullable).toBe(true)
    })

    it('detects _storage table', () => {
      const info = introspect(zx.id('_storage'))
      expect(info.isConvexId).toBe(true)
      expect(info.tableName).toBe('_storage')
    })

    it('does not detect plain string as convex id', () => {
      expect(introspect(z.string()).isConvexId).toBe(false)
    })
  })

  describe('container types', () => {
    it('introspects array with element type', () => {
      const info = introspect(z.array(z.string()))
      expect(info.baseType).toBe('array')
      expect(info.arrayElement).toBeDefined()
      expect(info.arrayElement!.baseType).toBe('string')
    })

    it('introspects nested array', () => {
      const info = introspect(z.array(z.array(z.number())))
      expect(info.baseType).toBe('array')
      expect(info.arrayElement!.baseType).toBe('array')
      expect(info.arrayElement!.arrayElement!.baseType).toBe('number')
    })

    it('introspects object with shape', () => {
      const info = introspect(
        z.object({
          name: z.string(),
          age: z.number().optional(),
          active: z.boolean()
        })
      )
      expect(info.baseType).toBe('object')
      expect(info.objectShape).toBeDefined()
      expect(info.objectShape!.name.baseType).toBe('string')
      expect(info.objectShape!.age.baseType).toBe('number')
      expect(info.objectShape!.age.isOptional).toBe(true)
      expect(info.objectShape!.active.baseType).toBe('boolean')
    })

    it('introspects nested objects', () => {
      const info = introspect(
        z.object({
          profile: z.object({
            email: z.string()
          })
        })
      )
      expect(info.objectShape!.profile.baseType).toBe('object')
      expect(info.objectShape!.profile.objectShape!.email.baseType).toBe('string')
    })

    it('introspects union', () => {
      const info = introspect(z.union([z.string(), z.number()]))
      expect(info.baseType).toBe('union')
      expect(info.unionOptions).toBeDefined()
      expect(info.unionOptions!.length).toBe(2)
      expect(info.unionOptions![0].baseType).toBe('string')
      expect(info.unionOptions![1].baseType).toBe('number')
    })

    it('introspects enum', () => {
      const info = introspect(z.enum(['admin', 'user', 'guest']))
      expect(info.baseType).toBe('enum')
      expect(info.enumValues).toBeDefined()
    })

    it('introspects record', () => {
      const info = introspect(z.record(z.string(), z.number()))
      expect(info.baseType).toBe('record')
    })

    it('introspects tuple', () => {
      const info = introspect(z.tuple([z.string(), z.number()]))
      expect(info.baseType).toBe('tuple')
    })
  })

  describe('literal values', () => {
    it('extracts string literal', () => {
      const info = introspect(z.literal('active'))
      expect(info.baseType).toBe('literal')
      expect(info.literalValue).toBe('active')
    })

    it('extracts number literal', () => {
      const info = introspect(z.literal(42))
      expect(info.baseType).toBe('literal')
      expect(info.literalValue).toBe(42)
    })

    it('extracts boolean literal', () => {
      const info = introspect(z.literal(true))
      expect(info.baseType).toBe('literal')
      expect(info.literalValue).toBe(true)
    })
  })

  describe('description', () => {
    it('extracts description from .describe()', () => {
      const info = introspect(z.string().describe('User email address'))
      expect(info.description).toBe('User email address')
    })

    it('extracts description through wrappers', () => {
      const info = introspect(z.string().describe('A name').optional())
      expect(info.description).toBeDefined()
    })
  })

  describe('metadata', () => {
    it('extracts .meta() metadata', () => {
      const info = introspect(z.string().meta({ encrypted: true }))
      expect(info.meta).toBeDefined()
      expect(info.meta!.encrypted).toBe(true)
    })
  })

  describe('codec types', () => {
    it('detects zx.date() as number base type (wire format)', () => {
      const info = introspect(zx.date())
      expect(info.baseType).toBe('number')
    })

    it('handles optional zx.date()', () => {
      const info = introspect(zx.date().optional())
      expect(info.baseType).toBe('number')
      expect(info.isOptional).toBe(true)
    })
  })
})

describe('convenience helpers', () => {
  describe('isConvexId', () => {
    it('returns true for zid', () => {
      expect(isConvexId(zid('users'))).toBe(true)
    })

    it('returns false for plain string', () => {
      expect(isConvexId(z.string())).toBe(false)
    })

    it('works with optional zid', () => {
      expect(isConvexId(zid('users').optional())).toBe(true)
    })
  })

  describe('getTableName', () => {
    it('returns table name from zid', () => {
      expect(getTableName(zid('users'))).toBe('users')
    })

    it('returns table name from zx.id', () => {
      expect(getTableName(zx.id('teams'))).toBe('teams')
    })

    it('returns undefined for non-id schemas', () => {
      expect(getTableName(z.string())).toBeUndefined()
    })

    it('returns table name for _storage', () => {
      expect(getTableName(zx.id('_storage'))).toBe('_storage')
    })
  })

  describe('isOptional', () => {
    it('returns true for optional', () => {
      expect(isOptional(z.string().optional())).toBe(true)
    })

    it('returns false for required', () => {
      expect(isOptional(z.string())).toBe(false)
    })
  })

  describe('isNullable', () => {
    it('returns true for nullable', () => {
      expect(isNullable(z.string().nullable())).toBe(true)
    })

    it('returns false for non-nullable', () => {
      expect(isNullable(z.string())).toBe(false)
    })
  })

  describe('hasDefault', () => {
    it('returns true when default exists', () => {
      expect(hasDefault(z.string().default('hello'))).toBe(true)
    })

    it('returns false when no default', () => {
      expect(hasDefault(z.string())).toBe(false)
    })
  })

  describe('getDefault', () => {
    it('returns the default value', () => {
      expect(getDefault(z.string().default('hello'))).toBe('hello')
    })

    it('returns undefined when no default', () => {
      expect(getDefault(z.string())).toBeUndefined()
    })

    it('returns numeric default', () => {
      expect(getDefault(z.number().default(0))).toBe(0)
    })

    it('returns false as default', () => {
      expect(getDefault(z.boolean().default(false))).toBe(false)
    })
  })

  describe('getBaseType', () => {
    it('returns base type for simple schemas', () => {
      expect(getBaseType(z.string())).toBe('string')
      expect(getBaseType(z.number())).toBe('number')
      expect(getBaseType(z.boolean())).toBe('boolean')
    })

    it('unwraps optional to get base type', () => {
      expect(getBaseType(z.string().optional())).toBe('string')
    })

    it('unwraps nullable to get base type', () => {
      expect(getBaseType(z.number().nullable())).toBe('number')
    })

    it('unwraps default to get base type', () => {
      expect(getBaseType(z.boolean().default(true))).toBe('boolean')
    })

    it('unwraps multiple wrappers', () => {
      expect(getBaseType(z.string().optional().nullable())).toBe('string')
    })
  })
})

describe('complex schemas', () => {
  it('handles a realistic form schema', () => {
    const formSchema = z.object({
      name: z.string(),
      email: z.string(),
      age: z.number().optional(),
      role: z.enum(['admin', 'user']).default('user'),
      teamId: zx.id('teams'),
      avatar: zx.id('_storage').optional(),
      tags: z.array(z.string()),
      active: z.boolean().default(true)
    })

    const info = introspect(formSchema)
    expect(info.baseType).toBe('object')
    expect(info.objectShape).toBeDefined()

    const shape = info.objectShape!
    expect(shape.name.baseType).toBe('string')
    expect(shape.email.baseType).toBe('string')
    expect(shape.age.baseType).toBe('number')
    expect(shape.age.isOptional).toBe(true)
    expect(shape.role.baseType).toBe('enum')
    expect(shape.role.hasDefault).toBe(true)
    expect(shape.role.defaultValue).toBe('user')
    expect(shape.teamId.isConvexId).toBe(true)
    expect(shape.teamId.tableName).toBe('teams')
    expect(shape.avatar.isConvexId).toBe(true)
    expect(shape.avatar.tableName).toBe('_storage')
    expect(shape.avatar.isOptional).toBe(true)
    expect(shape.tags.baseType).toBe('array')
    expect(shape.tags.arrayElement!.baseType).toBe('string')
    expect(shape.active.hasDefault).toBe(true)
    expect(shape.active.defaultValue).toBe(true)
  })

  it('handles deeply nested schema', () => {
    const schema = z.object({
      user: z.object({
        profile: z.object({
          name: z.string(),
          addresses: z.array(
            z.object({
              street: z.string(),
              city: z.string()
            })
          )
        })
      })
    })

    const info = introspect(schema)
    const addresses = info.objectShape!.user.objectShape!.profile.objectShape!.addresses
    expect(addresses.baseType).toBe('array')
    expect(addresses.arrayElement!.baseType).toBe('object')
    expect(addresses.arrayElement!.objectShape!.street.baseType).toBe('string')
  })
})
