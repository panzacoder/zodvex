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
    issues: error.issues.map((issue) => ({
      path: Array.isArray(issue.path) ? issue.path.join('.') : String(issue.path ?? ''),
      code: issue.code,
      message: issue.message
    })),
    // Keep a flattened snapshot for easier debugging without cyclic refs
    flatten: JSON.parse(JSON.stringify(error.flatten?.() ?? {}))
  }
}
