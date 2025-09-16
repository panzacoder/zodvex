import { z } from 'zod'
import { v, type Validator } from 'convex/values'
import { registryHelpers } from 'convex-helpers/server/zodV4'

// union helpers
export function makeUnion(members: any[]): any {
  const nonNull = members.filter(Boolean)
  if (nonNull.length === 0) return v.any()
  if (nonNull.length === 1) return nonNull[0]
  return v.union(nonNull[0], nonNull[1], ...nonNull.slice(2))
}

export function getObjectShape(obj: z.ZodObject<any>): Record<string, z.ZodTypeAny> {
  return (obj.shape || {}) as Record<string, z.ZodTypeAny>
}

export function analyzeZod(schema: z.ZodTypeAny): {
  base: z.ZodTypeAny
  optional: boolean
  nullable: boolean
  hasDefault: boolean
} {
  let s: z.ZodTypeAny = schema
  let optional = false
  let nullable = false
  let hasDefault = false

  while (s instanceof z.ZodDefault || s instanceof z.ZodOptional || s instanceof z.ZodNullable) {
    if (s instanceof z.ZodDefault) hasDefault = true
    if (s instanceof z.ZodOptional) optional = true
    if (s instanceof z.ZodNullable) nullable = true
    const next = (s as any).unwrap?.() ?? s
    if (next === s) break
    s = next as z.ZodTypeAny
  }
  if (s instanceof z.ZodUnion) {
    const opts = (s as z.ZodUnion<any>).options as z.ZodTypeAny[]
    if (opts && opts.some((o) => o instanceof z.ZodNull)) {
      nullable = true
    }
  }
  return { base: s, optional: optional || hasDefault, nullable, hasDefault }
}

export function simpleToConvex(schema: z.ZodTypeAny): any {
  const meta = analyzeZod(schema)
  const inner = meta.base

  try {
    const m = registryHelpers.getMetadata(inner as any)
    if (m?.isConvexId && m?.tableName && typeof m.tableName === 'string') {
      return v.id(m.tableName)
    }
  } catch {}

  if (inner instanceof z.ZodString) return v.string()
  if (inner instanceof z.ZodNumber) return v.float64()
  if (inner instanceof z.ZodBigInt) return v.int64()
  if (inner instanceof z.ZodBoolean) return v.boolean()
  if (inner instanceof z.ZodDate) return v.float64()
  if (inner instanceof z.ZodNull) return v.null()
  if (inner instanceof z.ZodAny) return v.any()
  if (inner instanceof z.ZodUnknown) return v.any()
  if ((z as any).ZodNever && inner instanceof (z as any).ZodNever) return v.any()
  if ((z as any).ZodUndefined && inner instanceof (z as any).ZodUndefined) return v.any()

  if (inner instanceof z.ZodLiteral) {
    return v.literal((inner as any).value)
  }

  if (inner instanceof z.ZodEnum) {
    const lits = (inner as any).options.map((opt: any) => v.literal(opt))
    return makeUnion(lits)
  }

  if (inner instanceof z.ZodUnion) {
    const opts: z.ZodTypeAny[] = (inner as z.ZodUnion<any>).options
    const nonNull = opts.filter((o) => !(o instanceof z.ZodNull))
    const members = nonNull.map((o) => simpleToConvex(o))
    return makeUnion(members)
  }

  if ((z as any).ZodDiscriminatedUnion && inner instanceof (z as any).ZodDiscriminatedUnion) {
    const members = (inner as any).options.map((o: z.ZodTypeAny) => simpleToConvex(o))
    return makeUnion(members)
  }

  if (inner instanceof z.ZodArray) {
    const el = (inner as z.ZodArray<any>).element as z.ZodTypeAny
    return v.array(simpleToConvex(el))
  }

  if (inner instanceof z.ZodObject) {
    const shape = getObjectShape(inner)
    const fields: Record<string, any> = {}
    for (const [k, child] of Object.entries(shape)) {
      fields[k] = convertWithMeta(child as z.ZodTypeAny, simpleToConvex(child as z.ZodTypeAny))
    }
    return v.object(fields)
  }

  if (inner instanceof z.ZodRecord) {
    const valueType = (inner as z.ZodRecord<any>).valueType as z.ZodTypeAny
    return v.record(v.string(), simpleToConvex(valueType))
  }

  if ((z as any).ZodTuple && inner instanceof (z as any).ZodTuple) {
    const items = ((inner as any)._def?.items ?? []) as z.ZodTypeAny[]
    const member = items.length ? makeUnion(items.map((i) => simpleToConvex(i))) : v.any()
    return v.array(member)
  }

  if ((z as any).ZodIntersection && inner instanceof (z as any).ZodIntersection) {
    const left = (inner as any)._def?.left as z.ZodTypeAny
    const right = (inner as any)._def?.right as z.ZodTypeAny
    if (left instanceof z.ZodObject && right instanceof z.ZodObject) {
      const l = getObjectShape(left)
      const r = getObjectShape(right)
      const keys = new Set([...Object.keys(l), ...Object.keys(r)])
      const fields: Record<string, any> = {}
      for (const k of keys) {
        const lz = l[k]
        const rz = r[k]
        if (lz && rz) {
          fields[k] = makeUnion([simpleToConvex(lz), simpleToConvex(rz)])
        } else {
          const zf = (lz || rz) as z.ZodTypeAny
          fields[k] = simpleToConvex(zf)
        }
      }
      return v.object(fields)
    }
  }

  return v.any()
}

export function convertWithMeta(zodField: z.ZodTypeAny, baseValidator: any): any {
  const meta = analyzeZod(zodField)
  let core = baseValidator

  const inner = meta.base
  if (inner instanceof z.ZodObject) {
    const childShape = getObjectShape(inner as any)
    const baseChildren: Record<string, any> = Object.fromEntries(
      Object.entries(childShape).map(([k, v]) => [k, simpleToConvex(v as z.ZodTypeAny)])
    )
    const rebuiltChildren: Record<string, any> = {}
    for (const [k, childZ] of Object.entries(childShape)) {
      rebuiltChildren[k] = convertWithMeta(childZ, baseChildren[k])
    }
    core = v.object(rebuiltChildren)
  } else if (inner instanceof z.ZodArray) {
    const elZod = (inner as z.ZodArray<any>).element as z.ZodTypeAny
    const baseEl = simpleToConvex(elZod)
    const rebuiltEl = convertWithMeta(elZod, baseEl)
    core = v.array(rebuiltEl)
  }

  if (meta.nullable) {
    core = makeUnion([core, v.null()])
  }
  if (meta.optional) {
    core = v.optional(core)
  }
  return core
}

export function zodToConvex(schema: z.ZodTypeAny): Validator<any, any, any> {
  return convertWithMeta(schema, simpleToConvex(schema))
}

export function zodToConvexFields(
  shapeOrObject: z.ZodRawShape | Record<string, z.ZodTypeAny> | z.ZodObject<any>
): Record<string, Validator<any, any, any>> {
  let shape: Record<string, z.ZodTypeAny>
  if (shapeOrObject instanceof z.ZodObject) {
    shape = getObjectShape(shapeOrObject as z.ZodObject<any>)
  } else {
    shape = shapeOrObject as Record<string, z.ZodTypeAny>
  }
  const out: Record<string, Validator<any, any, any>> = {}
  for (const [key, zodField] of Object.entries(shape)) {
    out[key] = convertWithMeta(zodField, simpleToConvex(zodField))
  }
  return out
}

