import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { defineZodSchema } from '../src/schema'
import { zodTable } from '../src/tables'
import { zx } from '../src/zx'

const Users = zodTable('users', {
  name: z.string(),
  createdAt: zx.date()
})

const Posts = zodTable('posts', {
  title: z.string(),
  authorId: zx.id('users')
})

describe('defineZodSchema', () => {
  it('returns an object with __zodTableMap', () => {
    const schema = defineZodSchema({ users: Users, posts: Posts })

    expect(schema.__zodTableMap).toBeDefined()
    expect(schema.__zodTableMap.users).toBeDefined()
    expect(schema.__zodTableMap.posts).toBeDefined()
  })

  it('captures full zodTable schema set in the table map', () => {
    const schema = defineZodSchema({ users: Users })
    const userSchemas = schema.__zodTableMap.users

    // Should have all schema variants
    expect(userSchemas.doc).toBeDefined()
    expect(userSchemas.insert).toBeDefined()
    expect(userSchemas.base).toBeDefined()
    expect(userSchemas.update).toBeDefined()
    expect(userSchemas.docArray).toBeDefined()

    // doc schema includes _id and _creationTime
    const parsed = userSchemas.doc.parse({
      _id: 'users:abc123',
      _creationTime: 1700000000000,
      name: 'Alice',
      createdAt: 1700000000000
    })
    expect(parsed.name).toBe('Alice')
    expect(parsed.createdAt).toBeInstanceOf(Date)

    // insert schema has user fields only (no system fields)
    const insertParsed = userSchemas.insert.parse({
      name: 'Bob',
      createdAt: 1700000000000
    })
    expect(insertParsed.name).toBe('Bob')
  })

  it('returns a valid Convex schema (has tables property)', () => {
    const schema = defineZodSchema({ users: Users, posts: Posts })

    // Convex schema objects have a `tables` property
    expect(schema).toHaveProperty('tables')
  })

  it('works with empty table set', () => {
    const schema = defineZodSchema({})

    expect(schema.__zodTableMap).toEqual({})
  })
})
