import { z } from 'zod'
import { zodTable } from './src/tables'
import { zid } from './src/ids'

// Create the same schema as FeaturedMembers
const featuredMembersSchema = z.object({
  choreographers: z.array(zid('users')).optional(),
  talent: z.array(zid('users')).optional()
})

const FeaturedMembers = zodTable('featuredMembers', featuredMembersSchema)

// Check the type
const table = FeaturedMembers.table

// Try to see what TypeScript infers
type TableType = typeof table

console.log('Test completed - check hover types')