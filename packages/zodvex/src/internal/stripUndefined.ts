/**
 * Recursively strips `undefined` values from objects and arrays.
 * Used by codec encode/decode to clean wire data.
 *
 * Extracted to its own module so client-safe code (boundaryHelpers)
 * can import it without pulling in zod via utils.ts.
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
