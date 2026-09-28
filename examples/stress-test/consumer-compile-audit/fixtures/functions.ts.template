import { initZodvex, defineZodSchema } from 'zodvex/server'
import * as server from './_generated/server'
// Deliberately isolate function boundaries; no modeled database workload.
export const { zq } = initZodvex(defineZodSchema({}), server, { wrapDb: false })
