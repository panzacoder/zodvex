/**
 * Server-only utilities — imports ConvexError from convex/values.
 * Do NOT re-export from core/index.ts or any client-safe barrel.
 */
import { ConvexError } from 'convex/values'
import { z } from 'zod'
import { $ZodError, $ZodType, encode, parse } from './zod-core'

// Format ZodError issues into a compact, consistent structure
export function formatZodIssues(
  error: z.ZodError, // zod-ok
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
  if (e instanceof $ZodError) {
    throw new ConvexError(formatZodIssues(e as z.ZodError, context)) // zod-ok
  }
  throw e
}

/**
 * Validates a return value against a Zod schema, supporting both codecs and regular schemas.
 *
 * Tries z.encode() first (for codec support), then falls back to .parse() if the schema
 * contains unidirectional transforms (which don't support encoding).
 *
 * For codecs: returns the encoded wire format (z.input<T>)
 * For transforms: returns the transformed output (z.output<T>)
 * For plain schemas: returns the validated value
 *
 * @param schema - The Zod schema to validate against
 * @param value - The value to validate
 * @returns The validated/encoded value
 * @throws Calls handleZodValidationError on validation failure
 */
export function validateReturns(schema: $ZodType, value: unknown): unknown {
  try {
    // Try encode first - works for codecs and plain schemas
    return encode(schema, value)
  } catch (e: any) {
    // If it's a unidirectional transform error, fall back to parse
    if (e?.message?.includes('unidirectional transform')) {
      try {
        return parse(schema, value)
      } catch (parseError) {
        handleZodValidationError(parseError, 'returns')
      }
    }
    // For any other error, handle it normally
    handleZodValidationError(e, 'returns')
  }
  // TypeScript can't infer that handleZodValidationError always throws
  throw new Error('Unreachable')
}
