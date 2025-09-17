import { z } from 'zod'

/**
 * Mark a Zod schema as "loose" to prevent deep type instantiation in TS.
 * Use this for very large object schemas where inference causes recursion limits.
 */
export function zLoose<T extends z.ZodTypeAny>(schema: T): T & { _zodvexLooseBrand: true } {
  return schema as T & { _zodvexLooseBrand: true }
}
