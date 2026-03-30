import { ZodError } from 'zod'
import {
  $ZodArray,
  $ZodCodec,
  $ZodDefault,
  $ZodError,
  $ZodNullable,
  $ZodObject,
  $ZodOptional,
  $ZodType,
  encode
} from './zod-core'

/**
 * Unwraps ZodOptional/ZodNullable/ZodDefault wrappers to get the structural type.
 */
function unwrapOuter(schema: $ZodType): $ZodType {
  let current: any = schema
  for (let i = 0; i < 10; i++) {
    if (current instanceof $ZodOptional || current instanceof $ZodNullable) {
      current = (current as any)._zod.def.innerType
      continue
    }
    if (current instanceof $ZodDefault) {
      current = (current as any).removeDefault()
      continue
    }
    break
  }
  return current as $ZodType
}

/**
 * Walks a path through a schema tree, truncating at codec boundaries.
 * When a codec is encountered, the path is cut — any deeper segments
 * are wire-internal and should not be exposed to consumers.
 */
function truncateAtCodecBoundary(path: (string | number)[], schema: $ZodType): (string | number)[] {
  const result: (string | number)[] = []
  let current: $ZodType = schema

  for (const segment of path) {
    current = unwrapOuter(current)

    // If we've landed on a codec, everything from here is wire-internal — stop
    if (current instanceof $ZodCodec) {
      break
    }

    // Descend into objects
    if (current instanceof $ZodObject && typeof segment === 'string') {
      const fieldSchema = (current as any).shape[segment] as $ZodType | undefined
      if (!fieldSchema) {
        // Unknown field — include segment and stop
        result.push(segment)
        break
      }

      result.push(segment)

      const unwrapped = unwrapOuter(fieldSchema)
      if (unwrapped instanceof $ZodCodec) {
        // Hit a codec boundary — truncate here
        break
      }

      current = fieldSchema
      continue
    }

    // Descend into arrays
    if (current instanceof $ZodArray && typeof segment === 'number') {
      result.push(segment)
      current = (current as any).element as $ZodType
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
export function normalizeCodecPaths(error: ZodError, schema: $ZodType): ZodError {
  const normalized = error.issues.map(issue => ({
    ...issue,
    path: truncateAtCodecBoundary(issue.path as (string | number)[], schema)
  }))
  return new ZodError(normalized)
}

/**
 * Encodes a value through a Zod schema, normalizing codec-internal
 * path segments in any ZodError before re-throwing.
 *
 * Drop-in replacement for `z.encode(schema, value)` at client boundaries.
 */
export function safeEncode(schema: $ZodType, value: unknown): unknown {
  try {
    return encode(schema, value)
  } catch (e) {
    if (e instanceof $ZodError) throw normalizeCodecPaths(e as ZodError, schema)
    throw e
  }
}
