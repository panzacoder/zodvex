import { describe, expect, it } from 'bun:test'
import { createCodecCustomization } from '../src/customization'
import {
  createMockDbReader,
  createMockDbWriter,
  userTableData,
  userTableMap
} from './fixtures/mock-db'

describe('createCodecCustomization', () => {
  it('returns query and mutation customization objects', () => {
    const codec = createCodecCustomization(userTableMap)
    expect(codec.query).toBeDefined()
    expect(codec.query.args).toEqual({})
    expect(codec.query.input).toBeTypeOf('function')
    expect(codec.mutation).toBeDefined()
    expect(codec.mutation.args).toEqual({})
    expect(codec.mutation.input).toBeTypeOf('function')
  })

  it('query customization wraps ctx.db with CodecDatabaseReader', async () => {
    const codec = createCodecCustomization(userTableMap)
    const mockCtx = { db: createMockDbReader(userTableData) }

    const result = await codec.query.input(mockCtx, {})

    // The wrapped db should decode docs
    const user = await result.ctx.db.get('users:1')
    expect(user.createdAt).toBeInstanceOf(Date)
  })

  it('query customization wraps ctx.db.query() with decoding', async () => {
    const codec = createCodecCustomization(userTableMap)
    const mockCtx = { db: createMockDbReader(userTableData) }

    const result = await codec.query.input(mockCtx, {})

    // The query chain path should also decode
    const users = await result.ctx.db.query('users').collect()
    expect(users[0].createdAt).toBeInstanceOf(Date)
  })

  it('mutation customization wraps ctx.db with CodecDatabaseWriter', async () => {
    const codec = createCodecCustomization(userTableMap)
    const { db, calls } = createMockDbWriter(userTableData)
    const mockCtx = { db }

    const result = await codec.mutation.input(mockCtx, {})

    // Reads should decode
    const user = await result.ctx.db.get('users:1')
    expect(user.createdAt).toBeInstanceOf(Date)

    // Writes should encode
    await result.ctx.db.insert('users', { name: 'Bob', createdAt: new Date(1700000000000) })
    expect(calls[0].args[1].createdAt).toBe(1700000000000)
  })
})
