import {
  query,
  mutation,
  action,
  internalQuery,
  internalMutation,
  internalAction,
} from './_generated/server'
import { initZodvex } from './_zodvex/server'

export const { zq, zm, za, ziq, zim, zia } = initZodvex({
  query,
  mutation,
  action,
  internalQuery,
  internalMutation,
  internalAction,
})
