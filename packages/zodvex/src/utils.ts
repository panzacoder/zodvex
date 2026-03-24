import { z } from 'zod'

// Private copy — importing from ./mapping pulls convex/values into client bundles
// (mapping/utils.ts imports `v` from convex/values which is server-only).
function getObjectShape(obj: any): Record<string, any> {
  if (obj instanceof z.ZodObject) return obj.shape
  if (obj && typeof obj === 'object' && typeof obj.shape === 'object')
    return obj.shape as Record<string, any>
  return {}
}

export function pick<T extends Record<string, any>, K extends keyof T>(
  obj: T,
  keys: K[]
): Pick<T, K> {
  const result = {} as Pick<T, K>
  for (const key of keys) {
    if (key in obj) result[key] = obj[key]
  }
  return result
}

// Typed identity helper for returns schemas
export function returnsAs<R extends z.ZodTypeAny>() {
  return <T extends z.input<R>>(v: T) => v
}

/**
 * Recursively strips undefined values from objects for Convex serialization.
 * Convex rejects objects with explicit undefined properties, so we need to
 * remove them before returning from handlers.
 *
 * Only processes plain objects (Object.prototype). Class instances, Dates,
 * and other non-plain objects are passed through unchanged.
 *
 * @param value - The value to strip undefined from
 * @returns The value with undefined properties removed from plain objects
 */
export function stripUndefined<T>(value: T): T {
  if (value === null || value === undefined) {
    return value
  }

  if (Array.isArray(value)) {
    return value.map(stripUndefined) as T
  }

  // Only process plain objects (not class instances, Dates, etc.)
  if (typeof value === 'object' && value.constructor === Object) {
    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value)) {
      if (val !== undefined) {
        result[key] = stripUndefined(val)
      }
    }
    return result as T
  }

  return value
}

// Helper: standard Convex paginate() result schema
export function zPaginated<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    page: z.array(item),
    isDone: z.boolean(),
    continueCursor: z.string().nullable().optional()
  })
}

/**
 * Maps Date fields to number fields for docSchema generation.
 * Handles Date, Date.optional(), Date.nullable(), and Date.default() cases.
 * Returns the original field for non-Date types.
 *
 * @deprecated Use `zx.date()` instead for automatic Date ↔ timestamp conversion.
 */
export function mapDateFieldToNumber(field: z.ZodTypeAny): z.ZodTypeAny {
  // Direct Date field
  if (field instanceof z.ZodDate) {
    return z.number()
  }

  // Optional Date field
  if (field instanceof z.ZodOptional && field.unwrap() instanceof z.ZodDate) {
    return z.number().optional()
  }

  // Nullable Date field
  if (field instanceof z.ZodNullable && field.unwrap() instanceof z.ZodDate) {
    return z.number().nullable()
  }

  // Date with default value
  if (field instanceof z.ZodDefault) {
    const inner = field.removeDefault()
    if (inner instanceof z.ZodDate) {
      return z.number().optional()
    }
  }

  // Non-Date field - return as-is
  return field
}

// Schema picking utilities (moved from pick.ts for consolidation)
type Mask = readonly string[] | Record<string, boolean | 1 | true>

function toKeys(mask: Mask): string[] {
  if (Array.isArray(mask)) return mask.map(String)
  return Object.keys(mask).filter(k => !!(mask as any)[k])
}

/**
 * Returns a plain shape object containing only the selected fields.
 * Accepts either a ZodObject or a raw shape object.
 */
export function pickShape(
  schemaOrShape: z.ZodObject<any> | Record<string, any>,
  mask: Mask
): Record<string, any> {
  const keys = toKeys(mask)
  const shape =
    schemaOrShape instanceof z.ZodObject ? getObjectShape(schemaOrShape) : schemaOrShape || {}

  const out: Record<string, any> = {}
  for (const k of keys) {
    if (k in shape) out[k] = (shape as any)[k]
  }
  return out
}

// Builds a fresh Zod object from the selected fields (avoids Zod's .pick())
export function safePick(schema: z.ZodObject<any>, mask: Mask): z.ZodObject<any> {
  return z.object(pickShape(schema, mask))
}

/**
 * Convenience: omit a set of keys by building the complement.
 * Avoids using Zod's .omit() which can cause type depth issues.
 */
export function safeOmit(schema: z.ZodObject<any>, mask: Mask): z.ZodObject<any> {
  const shape = getObjectShape(schema)
  const omit = new Set(toKeys(mask))
  const keep = Object.keys(shape).filter(k => !omit.has(k))
  const picked = pickShape(schema, keep)
  return z.object(picked)
}

/**
 * Recursively checks if a schema contains native z.date().
 * Stops recursion at ZodCodec boundaries since codecs handle their own transforms.
 */
function containsNativeZodDate(schema: z.ZodTypeAny): boolean {
  // Check if this is a native ZodDate (not our codec)
  if (schema instanceof z.ZodDate) {
    return true
  }

  // Codecs handle their own transforms - don't recurse into them
  if (schema instanceof z.ZodCodec) {
    return false
  }

  // Recurse into wrappers - cast unwrap result to ZodTypeAny for Zod v4 compatibility
  if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault
  ) {
    return containsNativeZodDate(schema.unwrap() as unknown as z.ZodTypeAny)
  }

  // Recurse into objects
  if (schema instanceof z.ZodObject) {
    return Object.values(schema.shape).some(field => containsNativeZodDate(field as z.ZodTypeAny))
  }

  // Recurse into arrays - cast element for Zod v4 compatibility
  if (schema instanceof z.ZodArray) {
    return containsNativeZodDate(schema.element as unknown as z.ZodTypeAny)
  }

  // Recurse into unions - cast options for Zod v4 compatibility
  if (schema instanceof z.ZodUnion) {
    return (schema.options as unknown as z.ZodTypeAny[]).some(opt => containsNativeZodDate(opt))
  }

  // Recurse into records - use valueType property (Zod v4)
  if (schema instanceof z.ZodRecord) {
    return containsNativeZodDate(schema.valueType as unknown as z.ZodTypeAny)
  }

  // Recurse into tuples - access items via def (Zod v4)
  if (schema instanceof z.ZodTuple) {
    const items = (schema as any).def?.items as z.ZodTypeAny[] | undefined
    return items ? items.some(item => containsNativeZodDate(item)) : false
  }

  return false
}

/**
 * Throws if schema contains native z.date() which isn't compatible with Convex.
 * Guides users to use zx.date() instead.
 *
 * @param schema - The Zod schema to check
 * @param context - Context for the error message (args, returns, schema)
 * @throws Error with migration guidance if z.date() is found
 */
export function assertNoNativeZodDate(
  schema: z.ZodTypeAny,
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
