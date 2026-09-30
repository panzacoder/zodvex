import type { $ZodType } from '../../internal/zod-core'
import { schemaShapeSource } from './schemaShapeSource'

export type CodecRef = {
  exportName: string
  sourceFile: string
}

export type UndiscoverableCodec = {
  functionPath?: string
  fieldPath: string
}

export type ZodToSourceContext = {
  /** Map from ZodCodec schema identity → reference info */
  codecMap: Map<$ZodType, CodecRef>
  /** Accumulates needed imports: sourceFile → Set of export names */
  neededCodecImports: Map<string, Set<string>>
  /** Codecs found during serialization that aren't in the codecMap */
  undiscoverableCodecs: UndiscoverableCodec[]
  /** Emit functional forms (z.optional(x)) instead of chaining (x.optional()) for zod/mini */
  mini?: boolean
}

/**
 * Converts a runtime Zod schema to its source code representation.
 * Used by the codegen engine to serialize ad-hoc schemas in the generated api.ts.
 *
 * Supports: primitives, objects, arrays, optional, nullable, enums, literals,
 * unions, tuples, records, and zodvex extensions (zx.id, zx.date).
 *
 * Unsupported types fall back to `z.any()` with a comment.
 */
export function zodToSource(schema: $ZodType, ctx?: ZodToSourceContext): string {
  return schemaShapeSource(schema, ctx)
}
