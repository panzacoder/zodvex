import { z } from 'zod'
import { stripUndefined } from '../utils'

/**
 * Decode a wire-format document to runtime format using a Zod schema.
 * Applies codec transforms (e.g., timestamp -> Date via zx.date()).
 *
 * @param schema - The Zod schema (typically zodTable.schema.doc)
 * @param raw - Wire-format document from Convex
 * @returns Decoded runtime-format document
 */
export function decodeDoc<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  return schema.parse(raw)
}

/**
 * Encode a runtime-format document to wire format using a Zod schema.
 * Applies codec transforms (e.g., Date -> timestamp via zx.date()).
 * Strips undefined values (Convex rejects explicit undefined).
 *
 * @param schema - The Zod schema (typically zodTable.schema.doc)
 * @param value - Runtime-format document
 * @returns Wire-format document for Convex storage
 */
export function encodeDoc<S extends z.ZodType>(schema: S, value: z.output<S>): z.input<S> {
  return stripUndefined(z.encode(schema, value))
}
