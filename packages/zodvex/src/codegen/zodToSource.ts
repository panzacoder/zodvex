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
} from '../internal/zod-core'

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
  // Peel off wrappers first (optional, nullable)
  if (schema instanceof $ZodOptional) {
    const inner = zodToSource(schema._zod.def.innerType, ctx)
    return ctx?.mini ? `z.optional(${inner})` : `${inner}.optional()`
  }
  if (schema instanceof $ZodNullable) {
    const inner = zodToSource(schema._zod.def.innerType, ctx)
    return ctx?.mini ? `z.nullable(${inner})` : `${inner}.nullable()`
  }

  // zodvex extensions — detect before generic types

  // zx.id('tableName') — ZodString with _tableName property (set by zid())
  // Prefer _tableName check (works in both zod and zod/mini),
  // fall back to .description check (full zod only)
  if (schema instanceof $ZodString) {
    const tableName =
      (schema as any)._tableName ??
      ((schema as any).description?.startsWith('convexId:')
        ? (schema as any).description.slice('convexId:'.length)
        : undefined)
    if (tableName) {
      return `zx.id("${tableName}")`
    }
  }

  // zx.date() — ZodCodec with in=ZodNumber, out=ZodCustom
  if (
    schema instanceof $ZodCodec &&
    schema._zod.def.in instanceof $ZodNumber &&
    schema._zod.def.out instanceof $ZodCustom
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
    const wireSource = zodToSource(schema._zod.def.in, ctx)
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
    const shape = schema._zod.def.shape
    const fields = Object.entries(shape)
      .map(([key, value]) => `${key}: ${zodToSource(value, ctx)}`)
      .join(', ')
    return `z.object({ ${fields} })`
  }

  // Arrays
  if (schema instanceof $ZodArray) {
    return `z.array(${zodToSource(schema._zod.def.element, ctx)})`
  }

  // Enums
  if (schema instanceof $ZodEnum) {
    const entries = schema._zod.def.entries
    const values = (Object.values(entries) as string[]).map((v: string) => `"${v}"`).join(', ')
    return `z.enum([${values}])`
  }

  // Literals
  if (schema instanceof $ZodLiteral) {
    const values = schema._zod.def.values
    const value = values.values().next().value
    if (typeof value === 'string') return `z.literal("${value}")`
    return `z.literal(${value})`
  }

  // Unions
  if (schema instanceof $ZodUnion) {
    const members = schema._zod.def.options.map(s => zodToSource(s, ctx)).join(', ')
    return `z.union([${members}])`
  }

  // Tuples
  if (schema instanceof $ZodTuple) {
    const items = schema._zod.def.items.map(s => zodToSource(s, ctx)).join(', ')
    return `z.tuple([${items}])`
  }

  // Records
  if (schema instanceof $ZodRecord) {
    return `z.record(${zodToSource(schema._zod.def.keyType, ctx)}, ${zodToSource(schema._zod.def.valueType, ctx)})`
  }

  // Fallback for unsupported types
  const typeName = schema._zod.def.type ?? 'unknown'
  return `z.any() /* unsupported: ${typeName} */`
}
