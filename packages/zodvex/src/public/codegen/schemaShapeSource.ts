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
} from '../../internal/zod-core'
import { isZxDateCodec } from '../../internal/zxDateBrand'

import type { ZodToSourceContext } from './zodToSource'

/**
 * Shape-only serialization shared with the original emitter. Keep this policy
 * stable for codec fingerprints (ADR-0010); fidelity improvements belong in
 * zodToSource, not here. Recursive calls stay within this policy.
 */
export function schemaShapeSource(schema: $ZodType, ctx?: ZodToSourceContext): string {
  // Peel off wrappers first (optional, nullable)
  if (schema instanceof $ZodOptional) {
    const inner = schemaShapeSource(schema._zod.def.innerType, ctx)
    return ctx?.mini ? `z.optional(${inner})` : `${inner}.optional()`
  }
  if (schema instanceof $ZodNullable) {
    const inner = schemaShapeSource(schema._zod.def.innerType, ctx)
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
      return `zx.id(${JSON.stringify(tableName)})`
    }
  }

  // zx.date() — brand check, not shape: a user codec with number wire +
  // custom runtime must be emitted as a named codec reference, not rewritten
  // to zx.date(), or decode produces a Date instead of the user's type (#100).
  if (schema instanceof $ZodCodec && isZxDateCodec(schema)) {
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
    const wireSource = schemaShapeSource(schema._zod.def.in, ctx)
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
      .map(([key, value]) => {
        const property =
          key === '__proto__'
            ? `[${JSON.stringify(key)}]`
            : /^[A-Za-z_$][\w$]*$/.test(key)
              ? key
              : JSON.stringify(key)
        return `${property}: ${schemaShapeSource(value, ctx)}`
      })
      .join(', ')
    return `z.object({ ${fields} })`
  }

  // Arrays
  if (schema instanceof $ZodArray) {
    return `z.array(${schemaShapeSource(schema._zod.def.element, ctx)})`
  }

  // Enums
  if (schema instanceof $ZodEnum) {
    const entries = schema._zod.def.entries
    const values = (Object.values(entries) as string[]).map(v => JSON.stringify(v)).join(', ')
    return `z.enum([${values}])`
  }

  // Literals
  if (schema instanceof $ZodLiteral) {
    const values = schema._zod.def.values
    const value = values.values().next().value
    if (typeof value === 'string') return `z.literal(${JSON.stringify(value)})`
    return `z.literal(${value})`
  }

  // Unions
  if (schema instanceof $ZodUnion) {
    const members = schema._zod.def.options.map(s => schemaShapeSource(s, ctx)).join(', ')
    return `z.union([${members}])`
  }

  // Tuples
  if (schema instanceof $ZodTuple) {
    const items = schema._zod.def.items.map(s => schemaShapeSource(s, ctx)).join(', ')
    return `z.tuple([${items}])`
  }

  // Records
  if (schema instanceof $ZodRecord) {
    return `z.record(${schemaShapeSource(schema._zod.def.keyType, ctx)}, ${schemaShapeSource(schema._zod.def.valueType, ctx)})`
  }

  // Fallback for unsupported types
  const typeName = schema._zod.def.type ?? 'unknown'
  return `z.any() /* unsupported: ${typeName} */`
}
