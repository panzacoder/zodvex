import { initZodvex } from 'zodvex/server'
import {
  query,
  mutation,
  action,
  internalQuery,
  internalMutation,
  internalAction,
} from './_generated/server'
import schema from './schema'

export const { zq, zm, za, ziq, zim, zia } = initZodvex(schema, {
  query,
  mutation,
  action,
  internalQuery,
  internalMutation,
  internalAction,
}, {
  // Dynamic import keeps `_zodvex/api.js` (which redeclares Zod schemas
  // for every registered function) out of the push-time isolate graph.
  // The registry is loaded once, on first action invocation, and cached.
  registry: async () => (await import('./_zodvex/api.js')).zodvexRegistry,
})
