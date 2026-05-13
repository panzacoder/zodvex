import { defineZodvexSchema } from 'zodvex/server'
import tables, { type DecodedDocs } from './_zodvex/tables'

export default defineZodvexSchema<typeof tables, DecodedDocs>(tables)
