import { z } from 'zod'

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
