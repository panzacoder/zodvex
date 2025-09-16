import { z } from 'zod'
import { v } from 'convex/values'
import { query, mutation } from '../_generated/server'
import { zodTable, zQuery, zMutation, convexCodec, zCrud } from 'zodvex'

// 1. Define a schema using Zod
const userSchema = z.object({
  name: z.string(),
  email: z.string().email(),
  age: z.number().min(0).max(150),
  bio: z.string().optional(),
  joinedAt: z.date(),
  isActive: z.boolean().default(true)
})

// 2. Create a Convex table from the Zod schema
export const Users = zodTable('users', userSchema)

// In your schema.ts, you would use:
// Users.table.index('by_email', ['email'])

// 3. Create type-safe Convex functions
export const getUser = zQuery(
  query,
  { email: z.string().email() },
  async (ctx, { email }) => {
    // TypeScript knows email is a string
    const user = await ctx.db
      .query('users')
      .withIndex('by_email', q => q.eq('email', email))
      .unique()
    return user
  }
)

export const createUser = zMutation(
  mutation,
  userSchema.omit({ joinedAt: true }),
  async (ctx, args) => {
    // args is fully typed based on the schema
    const userId = await ctx.db.insert('users', {
      ...args,
      joinedAt: new Date()
    })
    return userId
  }
)

// 4. Use the codec for data transformation
const UserCodec = convexCodec(userSchema)

// Example: Encoding data for storage
const userData = {
  name: 'John Doe',
  email: 'john@example.com',
  age: 30,
  joinedAt: new Date('2024-01-01'),
  isActive: true
}

const encoded = UserCodec.encode(userData)
// Dates are converted to timestamps for Convex storage

const decoded = UserCodec.decode(encoded)
// Timestamps are converted back to Date objects

// 5. Generate CRUD operations automatically
export const usersCrud = zCrud(Users, query, mutation)
// This gives you:
// - usersCrud.create
// - usersCrud.read
// - usersCrud.paginate
// - usersCrud.update
// - usersCrud.destroy

// 6. Advanced: Handle optional vs nullable correctly
const profileSchema = z.object({
  userId: z.string(),
  nickname: z.string().optional(), // Can be omitted
  avatar: z.string().nullable(), // Must be present, can be null
  website: z.string().optional().nullable() // Can be omitted OR null
})

// zodvex correctly maps these to Convex validators:
// nickname → v.optional(v.string())
// avatar → v.union(v.string(), v.null())
// website → v.optional(v.union(v.string(), v.null()))