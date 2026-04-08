import { z } from 'zod'
import { z as zm } from 'zod/mini'
import { defineZodModel, zx } from 'zodvex'
import { defineZodModel as defineMiniZodModel, zx as zxm } from 'zodvex/mini'
import { defineZodSchema, initZodvex } from 'zodvex/server'
import { defineZodSchema as defineMiniZodSchema, initZodvex as initMiniZodvex } from 'zodvex/mini/server'

declare const query: any
declare const mutation: any
declare const action: any
declare const internalQuery: any
declare const internalMutation: any
declare const internalAction: any

export const FullUserModel = defineZodModel('users', {
  email: z.string(),
  createdAt: zx.date()
}).index('by_email', ['email'])

export const FullSchema = defineZodSchema({
  users: FullUserModel
})

export const FullApi = initZodvex(FullSchema, {
  query,
  mutation,
  action,
  internalQuery,
  internalMutation,
  internalAction
})

export const MiniUserModel = defineMiniZodModel('users', {
  email: zm.string(),
  createdAt: zxm.date()
}).index('by_email', ['email'])

export const MiniSchema = defineMiniZodSchema({
  users: MiniUserModel
})

export const MiniApi = initMiniZodvex(MiniSchema, {
  query,
  mutation,
  action,
  internalQuery,
  internalMutation,
  internalAction
})
