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
import { zodvexRegistry } from './_zodvex/api.lazy.js'
import { zodTableMap } from './_zodvex/tableMap.lazy.js'

export const { zq, zm, za, ziq, zim, zia } = initZodvex(schema, {
  query,
  mutation,
  action,
  internalQuery,
  internalMutation,
  internalAction,
}, {
  registry: zodvexRegistry,
  tableMap: zodTableMap,
})
