import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineZodModel } from '../src/internal/model'
import { defineZodSchema } from '../src/internal/schema'
import { zx } from '../src/internal/zx'
import { zodTable } from '../src/legacy/tables'

const Users = zodTable('users', {
  name: z.string(),
  createdAt: zx.date()
})

const Posts = zodTable('posts', {
  title: z.string(),
  authorId: zx.id('users')
})

const TaskModel = defineZodModel('tasks', {
  title: z.string(),
  done: z.boolean()
})

const VisitModel = defineZodModel(
  'visits',
  z.discriminatedUnion('type', [
    z.object({ type: z.literal('phone'), duration: z.number() }),
    z.object({ type: z.literal('in-person'), roomId: z.string() })
  ])
)

const ProfileModel = defineZodModel(
  'profiles',
  z.object({
    displayName: z.string(),
    birthday: zx.date()
  })
)

describe('defineZodSchema', () => {
  it('returns an object with __zodTableMap', () => {
    const schema = defineZodSchema({ users: Users, posts: Posts })

    expect(schema.__zodTableMap).toBeDefined()
    expect(schema.__zodTableMap.users).toBeDefined()
    expect(schema.__zodTableMap.posts).toBeDefined()
  })

  it('captures doc and insert in the table map for zodTable entries', () => {
    const schema = defineZodSchema({ users: Users })
    const userSchemas = schema.__zodTableMap.users

    // zodTableMap is a runtime slice — only doc (decode) and insert (encode) retained.
    // Other derived schemas (docArray/paginatedDoc/base/update) are accessed via zx.* helpers.
    expect(userSchemas.doc).toBeDefined()
    expect(userSchemas.insert).toBeDefined()

    // doc schema includes _id and _creationTime
    const parsed = (userSchemas.doc as any).parse({
      _id: 'users:abc123',
      _creationTime: 1700000000000,
      name: 'Alice',
      createdAt: 1700000000000
    })
    expect(parsed.name).toBe('Alice')
    expect(parsed.createdAt).toBeInstanceOf(Date)

    // insert schema has user fields only (no system fields)
    const insertParsed = (userSchemas.insert as any).parse({
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

  // ===========================================================================
  // paginatedDoc derived from map.doc via zx.paginationResult
  // ===========================================================================

  it('paginatedDoc derived via zx.paginationResult for zodTable entries', () => {
    const schema = defineZodSchema({ users: Users })
    const userSchemas = schema.__zodTableMap.users

    const paginatedDoc = zx.paginationResult(userSchemas.doc) as any
    const result = paginatedDoc.safeParse({
      page: [{ _id: 'users:abc', _creationTime: 1, name: 'Alice', createdAt: 1700000000000 }],
      isDone: false,
      continueCursor: 'cursor_value'
    })
    expect(result.success).toBe(true)
  })

  // ===========================================================================
  // defineZodModel entries
  // ===========================================================================

  it('works with defineZodModel entries', () => {
    const schema = defineZodSchema({ tasks: TaskModel })

    expect(schema.__zodTableMap).toBeDefined()
    expect(schema.__zodTableMap.tasks).toBeDefined()

    const taskSchemas = schema.__zodTableMap.tasks
    expect(taskSchemas.doc).toBeDefined()
    expect(taskSchemas.insert).toBeDefined()
  })

  it('paginatedDoc derived via zx.paginationResult for defineZodModel entries', () => {
    const schema = defineZodSchema({ tasks: TaskModel })
    const taskSchemas = schema.__zodTableMap.tasks
    const paginatedDoc = zx.paginationResult(taskSchemas.doc) as any

    const result = paginatedDoc.safeParse({
      page: [{ _id: 'tasks:abc', _creationTime: 1, title: 'Test', done: false }],
      isDone: true,
      continueCursor: 'cursor_value'
    })
    expect(result.success).toBe(true)
  })

  // ===========================================================================
  // Union model via defineZodModel
  // ===========================================================================

  it('works with union defineZodModel entries', () => {
    const schema = defineZodSchema({ visits: VisitModel })

    expect(schema.__zodTableMap).toBeDefined()
    expect(schema.__zodTableMap.visits).toBeDefined()

    const visitSchemas = schema.__zodTableMap.visits
    expect(visitSchemas.doc).toBeDefined()
    expect(visitSchemas.insert).toBeDefined()
  })

  it('union model doc schema validates variants with system fields', () => {
    const schema = defineZodSchema({ visits: VisitModel })
    const visitSchemas = schema.__zodTableMap.visits

    const result = visitSchemas.doc.safeParse({
      type: 'phone',
      duration: 30,
      _id: 'visits:123',
      _creationTime: 1
    })
    expect(result.success).toBe(true)
  })

  it('works with object-schema defineZodModel entries', () => {
    const schema = defineZodSchema({ profiles: ProfileModel })
    const profileSchemas = schema.__zodTableMap.profiles

    expect(
      profileSchemas.doc.safeParse({
        displayName: 'Alice',
        birthday: 1700000000000,
        _id: 'profiles:123',
        _creationTime: 1
      }).success
    ).toBe(true)

    expect(
      profileSchemas.insert.safeParse({
        displayName: 'Alice',
        birthday: 1700000000000
      }).success
    ).toBe(true)
  })

  // ===========================================================================
  // Mixed zodTable + defineZodModel
  // ===========================================================================

  it('works with mixed zodTable and defineZodModel entries', () => {
    const schema = defineZodSchema({ users: Users, tasks: TaskModel, visits: VisitModel })

    expect(Object.keys(schema.__zodTableMap)).toEqual(['users', 'tasks', 'visits'])
    expect(schema).toHaveProperty('tables')
  })

  // ===========================================================================
  // Name validation for defineZodModel entries
  // ===========================================================================

  it('throws when model name does not match key', () => {
    const WrongName = defineZodModel('wrong_name', { title: z.string() })

    expect(() => defineZodSchema({ tasks: WrongName })).toThrow(
      "Model name 'wrong_name' does not match key 'tasks'"
    )
  })

  it('accepts model when name matches key', () => {
    expect(() => defineZodSchema({ tasks: TaskModel })).not.toThrow()
  })

  it('does not validate names for zodTable entries (no name property)', () => {
    // zodTable entries don't have a .name — validation only applies to models
    expect(() => defineZodSchema({ users: Users })).not.toThrow()
  })
})
