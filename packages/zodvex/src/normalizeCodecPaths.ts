import { z } from 'zod'

/**
 * Unwraps ZodOptional/ZodNullable/ZodDefault wrappers to get the structural type.
 */
function unwrapOuter(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current = schema
  for (let i = 0; i < 10; i++) {
    if (current instanceof z.ZodOptional || current instanceof z.ZodNullable) {
      current = current.unwrap() as unknown as z.ZodTypeAny
      continue
    }
    if (current instanceof z.ZodDefault) {
      current = current.removeDefault() as unknown as z.ZodTypeAny
      continue
    }
    break
  }
  return current
}

/**
 * Walks a path through a schema tree, truncating at codec boundaries.
 * When a codec is encountered, the path is cut — any deeper segments
 * are wire-internal and should not be exposed to consumers.
 */
function truncateAtCodecBoundary(
  path: (string | number)[],
  schema: z.ZodTypeAny
): (string | number)[] {
  const result: (string | number)[] = []
  let current: z.ZodTypeAny = schema

  for (const segment of path) {
    current = unwrapOuter(current)

    // If we've landed on a codec, everything from here is wire-internal — stop
    if (current instanceof z.ZodCodec) {
      break
    }

    // Descend into objects
    if (current instanceof z.ZodObject && typeof segment === 'string') {
      const fieldSchema = current.shape[segment] as z.ZodTypeAny | undefined
      if (!fieldSchema) {
        // Unknown field — include segment and stop
        result.push(segment)
        break
      }

      result.push(segment)

      const unwrapped = unwrapOuter(fieldSchema)
      if (unwrapped instanceof z.ZodCodec) {
        // Hit a codec boundary — truncate here
        break
      }

      current = fieldSchema
      continue
    }

    // Descend into arrays
    if (current instanceof z.ZodArray && typeof segment === 'number') {
      result.push(segment)
      current = current.element as unknown as z.ZodTypeAny
      continue
    }

    // For anything else (unions, records, etc.), include segment and continue
    result.push(segment)
  }

  return result
}

/**
 * Normalizes ZodError paths by truncating at codec boundaries.
 *
 * When z.encode() throws a ZodError, the paths reflect the wire schema
 * structure (e.g., ["email", "value"] for a custom codec).
 * This function strips the wire-internal segments so consumers see
 * clean field-level paths (e.g., ["email"]).
 */
export function normalizeCodecPaths(error: z.ZodError, schema: z.ZodTypeAny): z.ZodError {
  const normalized = error.issues.map(issue => ({
    ...issue,
    path: truncateAtCodecBoundary(issue.path as (string | number)[], schema)
  }))
  return new z.ZodError(normalized)
}

/**
 * Encodes a value through a Zod schema, normalizing codec-internal
 * path segments in any ZodError before re-throwing.
 *
 * Drop-in replacement for `z.encode(schema, value)` at client boundaries.
 */
export function safeEncode(schema: z.ZodTypeAny, value: unknown): unknown {
  try {
    return z.encode(schema, value)
  } catch (e) {
    if (e instanceof z.ZodError) throw normalizeCodecPaths(e, schema)
    throw e
  }
}
