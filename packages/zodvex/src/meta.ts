import type { z } from 'zod'

const META_KEY = '__zodvexMeta'

export type ZodvexFunctionMeta = {
  type: 'function'
  zodArgs?: z.ZodTypeAny
  zodReturns?: z.ZodTypeAny
}

export type ZodvexModelMeta = {
  type: 'model'
  tableName: string
  schemas: {
    doc: z.ZodTypeAny
    insert: z.ZodTypeAny
    update: z.ZodTypeAny
    docArray: z.ZodTypeAny
    paginatedDoc: z.ZodTypeAny
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
