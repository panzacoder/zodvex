import {
  $ZodAny,
  $ZodArray,
  $ZodBoolean,
  $ZodCodec,
  $ZodCustom,
  $ZodEnum,
  $ZodLiteral,
  $ZodNull,
  $ZodNullable,
  $ZodNumber,
  $ZodObject,
  $ZodOptional,
  $ZodRecord,
  $ZodString,
  $ZodTuple,
  $ZodType,
  $ZodUndefined,
  $ZodUnion
} from '../zod-core'

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
  // Cast to any — Zod v4's internal _zod.def properties are not publicly typed
  const def = (schema as any)._zod?.def as any

  // Peel off wrappers first (optional, nullable)
  if (schema instanceof $ZodOptional) {
    return `${zodToSource(def.innerType, ctx)}.optional()`
  }
  if (schema instanceof $ZodNullable) {
    return `${zodToSource(def.innerType, ctx)}.nullable()`
  }

  // zodvex extensions — detect before generic types

  // zx.id('tableName') — ZodString with description 'convexId:<tableName>'
  if (schema instanceof $ZodString && (schema as any).description?.startsWith('convexId:')) {
    const tableName = (schema as any).description.slice('convexId:'.length)
    return `zx.id("${tableName}")`
  }

  // zx.date() — ZodCodec with in=ZodNumber, out=ZodCustom
  if (
    schema instanceof $ZodCodec &&
    def.in instanceof $ZodNumber &&
    def.out instanceof $ZodCustom
  ) {
    return 'zx.date()'
  }

  // Generic ZodCodec — check codec map for identity match
  if (schema instanceof $ZodCodec) {
    if (ctx?.codecMap) {
      const ref = ctx.codecMap.get(schema)
      if (ref) {
        // Track the needed import
        if (!ctx.neededCodecImports.has(ref.sourceFile)) {
          ctx.neededCodecImports.set(ref.sourceFile, new Set())
        }
        ctx.neededCodecImports.get(ref.sourceFile)?.add(ref.exportName)
        return ref.exportName
      }
    }
    // Unknown codec — fall back to wire schema with warning
    const wireSource = zodToSource(def.in, ctx)
    ctx?.undiscoverableCodecs?.push({ fieldPath: 'unknown' })
    return `${wireSource} /* codec: transforms lost */`
  }

  // Primitives
  if (schema instanceof $ZodString) return 'z.string()'
  if (schema instanceof $ZodNumber) return 'z.number()'
  if (schema instanceof $ZodBoolean) return 'z.boolean()'
  if (schema instanceof $ZodNull) return 'z.null()'
  if (schema instanceof $ZodUndefined) return 'z.undefined()'
  if (schema instanceof $ZodAny) return 'z.any()'

  // Objects
  if (schema instanceof $ZodObject) {
    const shape = def.shape as Record<string, $ZodType>
    const fields = Object.entries(shape)
      .map(([key, value]) => `${key}: ${zodToSource(value, ctx)}`)
      .join(', ')
    return `z.object({ ${fields} })`
  }

  // Arrays
  if (schema instanceof $ZodArray) {
    return `z.array(${zodToSource(def.element, ctx)})`
  }

  // Enums
  if (schema instanceof $ZodEnum) {
    const entries = (schema as any)._zod.def.entries
    const values = (Object.keys(entries) as string[]).map((v: string) => `"${v}"`).join(', ')
    return `z.enum([${values}])`
  }

  // Literals
  if (schema instanceof $ZodLiteral) {
    const values = def.values as Set<unknown>
    const value = values.values().next().value
    if (typeof value === 'string') return `z.literal("${value}")`
    return `z.literal(${value})`
  }

  // Unions
  if (schema instanceof $ZodUnion) {
    const members = (def.options as $ZodType[]).map((s: $ZodType) => zodToSource(s, ctx)).join(', ')
    return `z.union([${members}])`
  }

  // Tuples
  if (schema instanceof $ZodTuple) {
    const items = (def.items as $ZodType[]).map((s: $ZodType) => zodToSource(s, ctx)).join(', ')
    return `z.tuple([${items}])`
  }

  // Records
  if (schema instanceof $ZodRecord) {
    return `z.record(${zodToSource(def.keyType, ctx)}, ${zodToSource(def.valueType, ctx)})`
  }

  // Fallback for unsupported types
  const typeName = def?.type ?? 'unknown'
  return `z.any() /* unsupported: ${typeName} */`
}
