import { test, expect } from 'bun:test'
import { z } from 'zod'
import { zodTable, zCrud } from '../src/tables'
import { query, mutation, internalQuery, internalMutation } from '../test-utils/convex-mocks'

test('zCrud returns properly typed functions', () => {
  const userShape = {
    name: z.string(),
    email: z.string().email(),
    age: z.number().optional()
  }

  const Users = zodTable('users', userShape)

  // Test with public query and mutation
  const publicCrud = zCrud(Users, query, mutation)

  // Type assertions - these should be correct types, not any
  const createType = typeof publicCrud.create
  const readType = typeof publicCrud.read

  expect(createType).toBe('object')
  expect(readType).toBe('object')

  // Test with internal query and mutation
  const internalCrud = zCrud(Users, internalQuery, internalMutation)

  expect(typeof internalCrud.create).toBe('object')
  expect(typeof internalCrud.read).toBe('object')
  expect(typeof internalCrud.update).toBe('object')
  expect(typeof internalCrud.destroy).toBe('object')
  expect(typeof internalCrud.paginate).toBe('object')
})