import type { $ZodType } from './zod-core'

const META_KEY = '__zodvexMeta'

export type ZodvexFunctionMeta = {
  type: 'function'
  zodArgs?: $ZodType
  zodReturns?: $ZodType
}

export type ZodvexModelDefinitionSource = 'shape' | 'schema'

export type ZodvexModelMeta = {
  type: 'model'
  tableName: string
  definitionSource?: ZodvexModelDefinitionSource
  schemas: {
    doc: $ZodType
    insert: $ZodType
    update: $ZodType
    docArray: $ZodType
    paginatedDoc: $ZodType
  }
}

export type ZodvexMeta = ZodvexFunctionMeta | ZodvexModelMeta

export function attachMeta(target: object, meta: ZodvexMeta): void {
  Object.defineProperty(target, META_KEY, {
    value: meta,
    enumerable: false,
    writable: false,
    configurable: false
  })
}

export function readMeta(target: unknown): ZodvexMeta | undefined {
  if (target == null || (typeof target !== 'object' && typeof target !== 'function')) {
    return undefined
  }
  return (target as Record<string, unknown>)[META_KEY] as ZodvexMeta | undefined
}
