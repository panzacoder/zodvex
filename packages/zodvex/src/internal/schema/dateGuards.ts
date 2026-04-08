import { z } from 'zod'
import {
  $ZodArray,
  $ZodCodec,
  $ZodDate,
  $ZodDefault,
  $ZodNullable,
  $ZodObject,
  $ZodOptional,
  $ZodRecord,
  $ZodTuple,
  $ZodType,
  $ZodUnion
} from '../zod-core'

/**
 * @deprecated Use `zx.date()` instead for automatic Date ↔ timestamp conversion.
 */
export function mapDateFieldToNumber(field: $ZodType): $ZodType {
  if (field instanceof $ZodDate) {
    return z.number()
  }
  if (field instanceof $ZodOptional && field._zod.def.innerType instanceof $ZodDate) {
    return z.optional(z.number())
  }
  if (field instanceof $ZodNullable && field._zod.def.innerType instanceof $ZodDate) {
    return z.nullable(z.number())
  }
  if (field instanceof $ZodDefault) {
    const inner = field._zod.def.innerType
    if (inner instanceof $ZodDate) {
      return z.optional(z.number())
    }
  }
  return field
}

function containsNativeZodDate(schema: $ZodType): boolean {
  if (schema instanceof $ZodDate) return true
  if (schema instanceof $ZodCodec) return false

  if (
    schema instanceof $ZodOptional ||
    schema instanceof $ZodNullable ||
    schema instanceof $ZodDefault
  ) {
    return containsNativeZodDate(schema._zod.def.innerType)
  }

  if (schema instanceof $ZodObject) {
    return Object.values(schema._zod.def.shape).some(field => containsNativeZodDate(field))
  }
  if (schema instanceof $ZodArray) {
    return containsNativeZodDate(schema._zod.def.element)
  }
  if (schema instanceof $ZodUnion) {
    return schema._zod.def.options.some(opt => containsNativeZodDate(opt))
  }
  if (schema instanceof $ZodRecord) {
    return containsNativeZodDate(schema._zod.def.valueType)
  }
  if (schema instanceof $ZodTuple) {
    const items = schema._zod.def.items
    return items ? items.some(item => containsNativeZodDate(item)) : false
  }

  return false
}

export function assertNoNativeZodDate(
  schema: $ZodType,
  context: 'args' | 'returns' | 'schema'
): void {
  if (containsNativeZodDate(schema)) {
    throw new Error(
      `[zodvex] Native z.date() found in ${context}. ` +
        `Convex stores dates as timestamps (numbers), which z.date() cannot parse.\n\n` +
        `Fix: Replace z.date() with zx.date()\n\n` +
        `Before: { createdAt: z.date() }\n` +
        `After:  { createdAt: zx.date() }\n\n` +
        `zx.date() is a codec that handles timestamp ↔ Date conversion automatically.`
    )
  }
}
