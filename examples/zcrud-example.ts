// Example of using zCrud with zodTable
import { z } from 'zod'
import { zodTable, zCrud } from '../src/tables'
import { query, mutation, internalQuery, internalMutation } from '../test-utils/convex-mocks'
import type { Id } from 'convex/values'

// Define a shape for users table
const userShape = {
  name: z.string(),
  email: z.string().email(),
  age: z.number().min(0).max(150).optional(),
  isActive: z.boolean().default(true),
  role: z.enum(['admin', 'user', 'guest']).default('user')
}

// Create a table with the shape
const Users = zodTable('users', userShape)

// Create CRUD operations with public query and mutation
export const publicCrud = zCrud(Users, query, mutation)

// Create CRUD operations with internal query and mutation
export const internalCrud = zCrud(Users, internalQuery, internalMutation)

// The exported functions are properly typed and can be used like:
// - publicCrud.create: creates a new user
// - publicCrud.read: reads a user by ID
// - publicCrud.update: updates a user by ID with partial fields
// - publicCrud.destroy: deletes a user by ID
// - publicCrud.paginate: paginates through users

// These are all properly typed RegisteredQuery/RegisteredMutation

// Example showing the types work correctly:
async function exampleUsage() {
  // These would be called from client code
  type CreateArgs = {
    name: string
    email: string
    age?: number
    // isActive and role have defaults, so they're optional
  }

  type UpdateArgs = {
    id: Id<'users'>
    patch: {
      name?: string
      email?: string
      age?: number
      isActive?: boolean
      role?: 'admin' | 'user' | 'guest'
    }
  }

  type ReadArgs = {
    id: Id<'users'>
  }

  // The functions are typed as RegisteredQuery/RegisteredMutation
  const create = publicCrud.create
  const read = publicCrud.read
  const update = publicCrud.update
  const destroy = publicCrud.destroy
  const paginate = publicCrud.paginate

  console.log('CRUD operations created successfully!')
}

exampleUsage()