import { defineZodModel as defineRootZodModel, type ZodModel as RootZodModel } from '../src'
import type { ZodModel as CoreCompatZodModel } from '../src/core'
import { defineZodModel as defineMiniZodModel, type ZodModel as MiniZodModel } from '../src/mini'
import type { Equal, Expect } from './test-helpers'
import { z } from 'zod'
import { z as zm } from 'zod/mini'
import type { ZodMiniObject, ZodMiniType } from 'zod/mini'

const rootFields = {
  name: z.string(),
  email: z.string().optional()
}

const miniFields = {
  name: zm.string(),
  email: zm.optional(zm.string())
}

const rootModel = defineRootZodModel('users', rootFields)
const miniModel = defineMiniZodModel('users', miniFields)

const acceptFullObject = <T extends z.ZodObject<any>>(schema: T) => schema
const acceptMiniObject = <T extends ZodMiniObject>(schema: T) => schema
const acceptMiniType = <T extends ZodMiniType>(schema: T) => schema

acceptFullObject(rootModel.schema.doc)
acceptMiniObject(miniModel.schema.doc)
acceptMiniType(miniModel.schema.doc)

type RootAnnotatedModel = RootZodModel<'users', typeof rootFields, z.ZodObject<typeof rootFields>>
type CoreCompatAnnotatedModel = CoreCompatZodModel<
  'users',
  typeof rootFields,
  z.ZodObject<typeof rootFields>
>
type MiniAnnotatedModel = MiniZodModel<'users', typeof miniFields, ZodMiniObject<typeof miniFields>>

type _RootAnnotatedDocExtendsFullObject = Expect<
  RootAnnotatedModel['schema']['doc'] extends z.ZodObject<any> ? true : false
>
type _CoreCompatModelMatchesRoot = Expect<Equal<CoreCompatAnnotatedModel, RootAnnotatedModel>>
type _MiniAnnotatedDocExtendsMiniObject = Expect<
  MiniAnnotatedModel['schema']['doc'] extends ZodMiniObject ? true : false
>
type _MiniAnnotatedDocExtendsMiniType = Expect<
  MiniAnnotatedModel['schema']['doc'] extends ZodMiniType ? true : false
>
