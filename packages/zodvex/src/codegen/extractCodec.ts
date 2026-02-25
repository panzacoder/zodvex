import { z } from 'zod'

/**
 * Unwraps ZodOptional/ZodNullable layers to find the inner ZodCodec.
 * Returns the codec instance, or undefined if none found.
 * Skips zx.date() (ZodCodec with in=ZodNumber, out=ZodCustom).
 *
 * Used by generated _zodvex/api.ts to extract codec references from model shapes.
 */
export function extractCodec(schema: z.ZodTypeAny): z.ZodTypeAny | undefined {
  let current = schema
  for (let i = 0; i < 10; i++) {
    if (current instanceof z.ZodCodec) {
      const def = (current as any)._zod?.def as any
      const isZxDate = def?.in instanceof z.ZodNumber && def?.out instanceof z.ZodCustom
      if (isZxDate) return undefined
      return current
    }
    if (current instanceof z.ZodOptional || current instanceof z.ZodNullable) {
      const def = (current as any)._zod?.def as any
      current = def.innerType
      continue
    }
    break
  }
  return undefined
}
