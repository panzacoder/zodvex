import { type Validator, v } from 'convex/values'
import { z } from 'zod'
import { registryHelpers } from './ids'
import { findBaseCodec } from './registry'

// union helpers
export function makeUnion(members: any[]): any {
  const nonNull = members.filter(Boolean)
  if (nonNull.length === 0) return v.any()
  if (nonNull.length === 1) return nonNull[0]
  return v.union(nonNull[0], nonNull[1], ...nonNull.slice(2))
}

export function getObjectShape(obj: any): Record<string, any> {
  // Use public API .shape property for ZodObject
  if (obj instanceof z.ZodObject) {
    return obj.shape
  }
  // Fallback for edge cases
  if (obj && typeof obj === 'object' && typeof obj.shape === 'object') {
    return obj.shape as Record<string, any>
  }
  return {}
}

export function analyzeZod(schema: any): {
  base: any
  optional: boolean
  nullable: boolean
  hasDefault: boolean
} {
  let s: any = schema
  let optional = false
  let nullable = false
  let hasDefault = false

  // Use instanceof checks to unwrap wrappers
  while (s) {
    if (s instanceof z.ZodDefault) {
      hasDefault = true
      optional = true
      s = s.removeDefault()
      continue
    }
    if (s instanceof z.ZodOptional) {
      optional = true
      s = s.unwrap()
      continue
    }
    if (s instanceof z.ZodNullable) {
      nullable = true
      s = s.unwrap()
      continue
    }
    if (s instanceof z.ZodPipe) {
      // For validator mapping, follow the output side
      s = s._def.out
      continue
    }
    break
  }

  // Check if union includes null
  if (s instanceof z.ZodUnion) {
    const opts = s.options as any[]
    if (opts && opts.some(o => o instanceof z.ZodNull)) {
      nullable = true
    }
  }

  return { base: s, optional: optional || hasDefault, nullable, hasDefault }
}

export function simpleToConvex(schema: any): any {
  const meta = analyzeZod(schema)
  const inner = meta.base

  // Check for custom Convex ID type
  try {
    const m = registryHelpers.getMetadata(inner as any)
    if (m?.isConvexId && m?.tableName && typeof m.tableName === 'string') {
      return v.id(m.tableName)
    }
  } catch {
    // ignore metadata errors
  }

  // Base type codec registry first (date, etc.)
  const base = findBaseCodec(inner as any)
  if (base) return base.toValidator(inner)

  // Use instanceof checks for type detection
  if (inner instanceof z.ZodString) {
    return v.string()
  }
  if (inner instanceof z.ZodNumber) {
    return v.float64()
  }
  if (inner instanceof z.ZodBigInt) {
    return v.int64()
  }
  if (inner instanceof z.ZodBoolean) {
    return v.boolean()
  }
  if (inner instanceof z.ZodDate) {
    return v.float64()
  }
  if (inner instanceof z.ZodNull) {
    return v.null()
  }
  if (inner instanceof z.ZodUndefined || inner instanceof z.ZodNever) {
    return v.any()
  }
  if (inner instanceof z.ZodAny || inner instanceof z.ZodUnknown) {
    return v.any()
  }
  if (inner instanceof z.ZodLiteral) {
    return v.literal((inner as any).value)
  }
  if (inner instanceof z.ZodEnum) {
    // Check if it's a native enum (has .enum property) or regular enum (has .options)
    const values = 'enum' in inner ? Object.values((inner as any).enum) : (inner as any).options || []
    return makeUnion(values.map((val: any) => v.literal(val as any)))
  }
  if (inner instanceof z.ZodUnion) {
    const opts = inner.options as any[]
    const nonNull = opts.filter(o => !(o instanceof z.ZodNull))
    const members = nonNull.map(o => simpleToConvex(o))
    return makeUnion(members)
  }
  if (inner instanceof z.ZodArray) {
    const el = inner.element
    return v.array(simpleToConvex(el))
  }
  if (inner instanceof z.ZodObject) {
    const shape = inner.shape
    const fields: Record<string, any> = {}
    for (const [k, child] of Object.entries(shape)) {
      fields[k] = convertWithMeta(child as any, simpleToConvex(child as any))
    }
    return v.object(fields)
  }
  if (inner instanceof z.ZodRecord) {
    const valueType = inner.valueType
    return v.record(v.string(), valueType ? simpleToConvex(valueType) : v.string())
  }
  if (inner instanceof z.ZodTuple) {
    const items = (inner as any).items || []
    const member = items.length ? makeUnion(items.map((i: any) => simpleToConvex(i))) : v.any()
    return v.array(member)
  }
  if (inner instanceof z.ZodIntersection) {
    const left = inner._def.left
    const right = inner._def.right
    if (left instanceof z.ZodObject && right instanceof z.ZodObject) {
      const l = left.shape
      const r = right.shape
      const keys = new Set([...Object.keys(l), ...Object.keys(r)])
      const fields: Record<string, any> = {}
      for (const k of keys) {
        const lz = l[k]
        const rz = r[k]
        if (lz && rz) {
          fields[k] = makeUnion([simpleToConvex(lz), simpleToConvex(rz)])
        } else {
          fields[k] = simpleToConvex((lz || rz) as any)
        }
      }
      return v.object(fields)
    }
    return v.any()
  }
  if (inner instanceof z.ZodLazy) {
    // Try to get the schema, but fallback to any if it fails
    try {
      const resolved = inner._def.getter()
      return simpleToConvex(resolved)
    } catch {
      return v.any()
    }
  }
  if (inner instanceof z.ZodTransform || inner instanceof z.ZodPipe) {
    // For transforms and pipelines, use the input schema for validation
    const def = inner._def as any
    const innerSchema = def.schema || def.in || def.out
    if (innerSchema && innerSchema !== inner) {
      return simpleToConvex(innerSchema)
    }
    // If we can't find the inner schema, return any to avoid infinite recursion
    return v.any()
  }

  // Fallback for unknown types
  return v.any()
}

function convertWithMeta(schema: any, baseValidator: any): any {
  const { optional, nullable } = analyzeZod(schema)

  let validator = baseValidator
  if (nullable && !optional) {
    validator = v.union(baseValidator, v.null())
  } else if (!nullable && optional) {
    validator = v.optional(baseValidator)
  } else if (nullable && optional) {
    validator = v.optional(v.union(baseValidator, v.null()))
  }

  return validator
}

export function zodToConvex(schema: any): Validator<any, any, any> {
  const meta = analyzeZod(schema)
  const baseValidator = simpleToConvex(meta.base)

  let validator = baseValidator
  if (meta.nullable && !meta.optional) {
    validator = v.union(baseValidator, v.null())
  } else if (!meta.nullable && meta.optional) {
    validator = v.optional(baseValidator)
  } else if (meta.nullable && meta.optional) {
    validator = v.optional(v.union(baseValidator, v.null()))
  }

  return validator as any
}

export function zodToConvexFields(schemaOrShape: any): Record<string, any> {
  // Handle both ZodObject and plain shape objects
  const shape = schemaOrShape instanceof z.ZodObject
    ? schemaOrShape.shape
    : schemaOrShape

  const result: Record<string, any> = {}
  for (const [key, value] of Object.entries(shape)) {
    result[key] = zodToConvex(value)
  }
  return result
}