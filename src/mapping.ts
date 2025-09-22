import { type Validator, v } from 'convex/values'
import { registryHelpers } from './ids'
import { findBaseCodec } from './registry'
import { type Expand } from './types'
import { getDef, isObjectSchema, isZ4Schema } from './z4'

// union helpers
export function makeUnion(members: any[]): any {
  const nonNull = members.filter(Boolean)
  if (nonNull.length === 0) return v.any()
  if (nonNull.length === 1) return nonNull[0]
  return v.union(nonNull[0], nonNull[1], ...nonNull.slice(2))
}

export function getObjectShape(obj: any): Record<string, any> {
  if (isObjectSchema(obj)) {
    const def = getDef(obj)
    return (def.shape || {}) as Record<string, any>
  }
  // Fallback (legacy dev builds) — cautiously access shape to avoid dts errors
  const anyObj = obj as any
  if (anyObj && typeof anyObj === 'object' && typeof anyObj.shape === 'object') {
    return anyObj.shape as Record<string, any>
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

  for (;;) {
    if (!isZ4Schema(s)) break
    const def = getDef(s)
    if (def.type === 'default') {
      hasDefault = true
      optional = true
      s = def.innerType
      continue
    }
    if (def.type === 'optional') {
      optional = true
      s = def.innerType
      continue
    }
    if (def.type === 'nullable') {
      nullable = true
      s = def.innerType
      continue
    }
    if (def.type === 'pipe') {
      // For validator mapping, follow the output side
      s = def.out
      continue
    }
    break
  }

  // If union includes null, mark as nullable
  if (isZ4Schema(s) && getDef(s).type === 'union') {
    const opts: any[] = getDef(s).options as any[]
    if (opts && opts.some(o => isZ4Schema(o) && getDef(o).type === 'null')) {
      nullable = true
    }
  }
  return { base: s, optional: optional || hasDefault, nullable, hasDefault }
}

export function simpleToConvex(schema: any): any {
  const meta = analyzeZod(schema)
  const inner = meta.base

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

  if (!isZ4Schema(inner)) return v.any()
  const def = getDef(inner)

  switch (def.type) {
    case 'string':
      return v.string()
    case 'number':
      return v.float64()
    case 'bigint':
      return v.int64()
    case 'boolean':
      return v.boolean()
    case 'date':
      return v.float64()
    case 'null':
      return v.null()
    case 'any':
    case 'unknown':
    case 'never':
    case 'undefined':
      return v.any()
    case 'literal': {
      const values: any[] = def.values ?? []
      if (values.length === 1) return v.literal(values[0])
      return makeUnion(values.map(val => v.literal(val)))
    }
    case 'enum': {
      const valuesSet: Set<any> | undefined = (inner as any)._zod?.values
      const values: any[] = valuesSet ? Array.from(valuesSet) : (def.entries ? (def.entries as any[]) : [])
      return makeUnion(values.map(val => v.literal(val)))
    }
    case 'union': {
      const opts: any[] = def.options as any[]
      const nonNull = opts.filter(o => !(isZ4Schema(o) && getDef(o).type === 'null'))
      const members = nonNull.map(o => simpleToConvex(o))
      return makeUnion(members)
    }
    case 'array': {
      const el = def.element
      return v.array(simpleToConvex(el))
    }
    case 'object': {
      const shape = getObjectShape(inner)
      const fields: Record<string, any> = {}
      for (const [k, child] of Object.entries(shape)) {
        fields[k] = convertWithMeta(child as any, simpleToConvex(child as any))
      }
      return v.object(fields)
    }
    case 'record': {
      const valueType = def.valueType
      return v.record(v.string(), valueType ? simpleToConvex(valueType) : v.string())
    }
    case 'tuple': {
      const items: any[] = def.items ?? []
      const member = items.length ? makeUnion(items.map(i => simpleToConvex(i))) : v.any()
      return v.array(member)
    }
    case 'intersection': {
      const left = def.left
      const right = def.right
      if (isObjectSchema(left) && isObjectSchema(right)) {
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
            const zf = (lz || rz) as any
            fields[k] = simpleToConvex(zf)
          }
        }
        return v.object(fields)
      }
      return v.any()
    }
    default:
      return v.any()
  }
}

export function convertWithMeta(zodField: any, baseValidator: any): any {
  const meta = analyzeZod(zodField)
  let core = baseValidator

  const inner = meta.base
  if (isZ4Schema(inner)) {
    const def = getDef(inner)
    if (def.type === 'object') {
      const childShape = getObjectShape(inner)
      const baseChildren: Record<string, any> = Object.fromEntries(
        Object.entries(childShape).map(([k, v]) => [k, simpleToConvex(v as any)])
      )
      const rebuiltChildren: Record<string, any> = {}
      for (const [k, childZ] of Object.entries(childShape)) {
        rebuiltChildren[k] = convertWithMeta(childZ, baseChildren[k])
      }
      core = v.object(rebuiltChildren)
    } else if (def.type === 'array') {
      const elZod = def.element
      const baseEl = simpleToConvex(elZod)
      const rebuiltEl = convertWithMeta(elZod, baseEl)
      core = v.array(rebuiltEl)
    }
  }

  if (meta.nullable) {
    core = makeUnion([core, v.null()])
  }
  if (meta.optional) {
    core = v.optional(core)
  }
  return core
}

export function zodToConvex(schema: any): any {
  return convertWithMeta(schema, simpleToConvex(schema))
}

export function zodToConvexFields(
  shapeOrObject: Record<string, any> | any
): Expand<Record<string, any>> {
  let shape: Record<string, any>
  if (isObjectSchema(shapeOrObject)) {
    shape = getObjectShape(shapeOrObject)
  } else {
    shape = shapeOrObject as Record<string, any>
  }
  const out: Record<string, Validator<any, any, any>> = {}
  for (const [key, zodField] of Object.entries(shape)) {
    out[key] = convertWithMeta(zodField, simpleToConvex(zodField))
  }
  return out as Expand<Record<string, any>>
}
