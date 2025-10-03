import { ConvexError } from 'convex/values'
import { z } from 'zod'
import { getObjectShape } from './mapping'

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

// Format ZodError issues into a compact, consistent structure
export function formatZodIssues(
  error: z.ZodError,
  context?: 'args' | 'returns' | 'input' | 'output' | 'codec'
) {
  return {
    error: 'ZodValidationError',
    context,
    issues: error.issues.map(issue => ({
      path: Array.isArray(issue.path) ? issue.path.join('.') : String(issue.path ?? ''),
      code: issue.code,
      message: issue.message
    })),
    // Keep a flattened snapshot for easier debugging without cyclic refs
    flatten: JSON.parse(JSON.stringify(error.flatten?.() ?? {}))
  }
}

// Handle Zod validation errors consistently across all wrappers
// Throws a ConvexError with formatted issues if the error is a ZodError, otherwise re-throws
export function handleZodValidationError(
  e: unknown,
  context: 'args' | 'returns' | 'input' | 'output' | 'codec'
): never {
  if (e instanceof z.ZodError) {
    throw new ConvexError(formatZodIssues(e, context))
  }
  throw e
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
