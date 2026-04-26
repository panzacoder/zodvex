/**
 * Serializes a runtime Convex validator (the kind produced by `zodToConvex`)
 * back to its `v.*(...)` source representation. Mirrors the shape Convex's
 * own `v.*` constructors emit at runtime, so the output is round-trippable.
 *
 * Used by `zodvex compile` to inline pre-computed validator literals at build
 * time, eliminating the retained Zod schema instances from the push-time
 * isolate.
 */

type ConvexValidator = {
  kind: string
  isOptional?: 'required' | 'optional'
  // shape varies by kind
  [k: string]: unknown
}

/**
 * Serializes a single validator (the kind that goes in `returns:` or as
 * a record value in `args:`).
 */
export function convexValidatorToSource(v: unknown): string {
  if (v == null || typeof v !== 'object') return 'v.any()'
  const validator = v as ConvexValidator

  const inner = serializeBase(validator)
  return validator.isOptional === 'optional' ? `v.optional(${inner})` : inner
}

/**
 * Serializes a Convex args record (`{ id: <validator>, name: <validator>, ... }`)
 * to its source form. Args are NOT wrapped in `v.object(...)` — Convex accepts
 * a raw record of validators as the `args:` field.
 */
export function convexArgsToSource(args: Record<string, unknown>): string {
  const entries = Object.entries(args)
  if (entries.length === 0) return '{}'
  const fields = entries
    .map(([k, val]) => `${quoteKey(k)}: ${convexValidatorToSource(val)}`)
    .join(', ')
  return `{ ${fields} }`
}

function serializeBase(v: ConvexValidator): string {
  switch (v.kind) {
    case 'string':
      return 'v.string()'
    case 'float64':
      return 'v.float64()'
    case 'int64':
      return 'v.int64()'
    case 'boolean':
      return 'v.boolean()'
    case 'null':
      return 'v.null()'
    case 'bytes':
      return 'v.bytes()'
    case 'any':
      return 'v.any()'
    case 'id':
      return `v.id(${JSON.stringify(v.tableName)})`
    case 'literal':
      return `v.literal(${formatLiteralValue(v.value)})`
    case 'array':
      return `v.array(${convexValidatorToSource(v.element)})`
    case 'object': {
      const fields = (v.fields ?? {}) as Record<string, unknown>
      const entries = Object.entries(fields)
      if (entries.length === 0) return 'v.object({})'
      const body = entries
        .map(([k, val]) => `${quoteKey(k)}: ${convexValidatorToSource(val)}`)
        .join(', ')
      return `v.object({ ${body} })`
    }
    case 'union': {
      const members = (v.members ?? []) as unknown[]
      if (members.length === 0) return 'v.any() /* empty union */'
      if (members.length === 1) return convexValidatorToSource(members[0])
      const body = members.map(m => convexValidatorToSource(m)).join(', ')
      return `v.union(${body})`
    }
    case 'record': {
      const rec = v as unknown as { key: unknown; value: unknown }
      return `v.record(${convexValidatorToSource(rec.key)}, ${convexValidatorToSource(rec.value)})`
    }
    default:
      return `v.any() /* unsupported kind: ${String(v.kind)} */`
  }
}

function formatLiteralValue(value: unknown): string {
  if (typeof value === 'bigint') return `${value.toString()}n`
  return JSON.stringify(value)
}

const VALID_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

function quoteKey(k: string): string {
  return VALID_IDENTIFIER.test(k) ? k : JSON.stringify(k)
}
