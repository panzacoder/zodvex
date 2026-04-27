/**
 * Serializes a runtime Convex validator (the kind produced by `zodToConvex`)
 * back to its `v.*(...)` source representation. Mirrors the shape Convex's
 * own `v.*` constructors emit at runtime, so the output is round-trippable.
 *
 * Used by `zodvex compile` to inline pre-computed validator literals at build
 * time. With an optional `SharingContext`, the serializer emits references
 * to a model's exported `*Fields` record (e.g. `commentFields.body`) and
 * `...commentFields` spreads when an object's leaves structurally match a
 * model's fields — matching the idiomatic convex authoring pattern that the
 * stress-test convex baseline uses.
 */

type ConvexValidator = {
  kind: string
  isOptional?: 'required' | 'optional'
  // shape varies by kind
  [k: string]: unknown
}

export type ModelFieldsInfo = {
  /** e.g. 'commentFields' — the symbol other files import to share validators. */
  fieldsRecordName: string
  /** Map fieldName -> structural key for matching. */
  fieldKeys: Map<string, string>
  /** Map fieldName -> Convex validator instance (for runtime reference). */
  fields: Record<string, unknown>
}

export type SharingContext = {
  /**
   * Reverse index: structural key -> list of (fieldsRecordName, fieldName).
   * Multiple candidates are common across models (every `name: v.string()`
   * field has the same key); resolution prefers the `preferredRecordNames`
   * set on the call to keep matches scoped to the endpoint's own model.
   */
  refsByKey: Map<string, Array<{ fieldsRecordName: string; fieldName: string }>>
  /**
   * tableName → fieldsRecordName, populated when models are registered. Used
   * by the compile driver to derive `preferredRecordNames` per endpoint by
   * walking the endpoint's `v.id(table)` validators.
   */
  recordByTable: Map<string, string>
  /**
   * For spread detection: list of every model and its full sorted field map.
   * The spread match always uses the largest model first regardless of
   * preferred-record scoping (a full-record match is unambiguous).
   */
  models: ModelFieldsInfo[]
  /**
   * Tracks which `*Fields` records were referenced during this serialization.
   * The compile driver reads this to inject the matching imports.
   */
  usedRecords: Set<string>
  /**
   * Set by the driver per-endpoint. When non-empty, named-leaf matches only
   * succeed when the candidate's `fieldsRecordName` is in this set. Empty
   * means "share with anything" (rare — used for model-internal serialization).
   */
  preferredRecordNames?: Set<string>
}

export function createSharingContext(): SharingContext {
  return {
    refsByKey: new Map(),
    recordByTable: new Map(),
    models: [],
    usedRecords: new Set()
  }
}

/**
 * Adds a model's fields to the context. Computes structural keys eagerly so
 * subsequent serialization is just hash lookups.
 */
export function registerModelFields(
  ctx: SharingContext,
  fieldsRecordName: string,
  fields: Record<string, unknown>,
  tableName?: string
): void {
  const fieldKeys = new Map<string, string>()
  for (const [name, validator] of Object.entries(fields)) {
    const key = structuralKey(validator)
    fieldKeys.set(name, key)
    let bucket = ctx.refsByKey.get(key)
    if (!bucket) {
      bucket = []
      ctx.refsByKey.set(key, bucket)
    }
    bucket.push({ fieldsRecordName, fieldName: name })
  }
  ctx.models.push({ fieldsRecordName, fieldKeys, fields })
  if (tableName) ctx.recordByTable.set(tableName, fieldsRecordName)
}

/**
 * Stable structural fingerprint for a Convex validator. Two validators with
 * the same key are interchangeable for sharing purposes — same `kind`, same
 * `tableName` (id), same `value` (literal), same nested shape.
 */
function structuralKey(v: unknown): string {
  if (v == null || typeof v !== 'object') return 'any'
  const validator = v as ConvexValidator
  const opt = validator.isOptional === 'optional' ? '?' : ''
  switch (validator.kind) {
    case 'string':
    case 'float64':
    case 'int64':
    case 'boolean':
    case 'null':
    case 'bytes':
    case 'any':
      return `${validator.kind}${opt}`
    case 'id':
      return `id:${String(validator.tableName)}${opt}`
    case 'literal':
      return `literal:${JSON.stringify(validator.value)}${opt}`
    case 'array':
      return `array:${structuralKey(validator.element)}${opt}`
    case 'object': {
      const fields = (validator.fields ?? {}) as Record<string, unknown>
      const entries = Object.entries(fields)
        .map(([k, val]) => `${k}=${structuralKey(val)}`)
        .sort()
      return `object:{${entries.join(',')}}${opt}`
    }
    case 'union': {
      const members = (validator.members ?? []) as unknown[]
      const memberKeys = members.map(structuralKey).sort()
      return `union:[${memberKeys.join(',')}]${opt}`
    }
    case 'record': {
      const rec = validator as unknown as { key: unknown; value: unknown }
      return `record:${structuralKey(rec.key)}->${structuralKey(rec.value)}${opt}`
    }
    default:
      return `any:${String(validator.kind)}${opt}`
  }
}

/**
 * Serializes a single validator (the kind that goes in `returns:` or as
 * a record value in `args:`).
 *
 * `propertyName`, when provided, is the key under which this validator
 * appears in its parent object. It enables "named leaf" sharing — if the
 * property name matches a model field name AND the validator structurally
 * matches that field, we emit the reference.
 */
export function convexValidatorToSource(
  v: unknown,
  ctx?: SharingContext,
  propertyName?: string
): string {
  if (v == null || typeof v !== 'object') return 'v.any()'
  const validator = v as ConvexValidator

  // Try sharing via "named leaf": same key in args/returns as in a model record.
  if (ctx && propertyName) {
    const ref = matchNamedLeaf(ctx, validator, propertyName)
    if (ref) {
      ctx.usedRecords.add(ref.fieldsRecordName)
      return `${ref.fieldsRecordName}.${ref.fieldName}`
    }
  }

  const inner = serializeBase(validator, ctx)
  return validator.isOptional === 'optional' ? `v.optional(${inner})` : inner
}

function matchNamedLeaf(
  ctx: SharingContext,
  validator: ConvexValidator,
  propertyName: string
): { fieldsRecordName: string; fieldName: string } | undefined {
  const key = structuralKey(validator)
  const candidates = ctx.refsByKey.get(key)
  if (!candidates) return undefined
  // Both structural key AND property name must match. Additionally, when
  // `preferredRecordNames` is set (always, in the endpoint path), restrict
  // matching to that set — keeps `commentFields.body` from binding to the
  // first registered `*Fields.body` of any model in the project.
  return candidates.find(
    c =>
      c.fieldName === propertyName &&
      (!ctx.preferredRecordNames || ctx.preferredRecordNames.has(c.fieldsRecordName))
  )
}

/**
 * Serializes a Convex args record (`{ id: <validator>, name: <validator>, ... }`)
 * to its source form. Args are NOT wrapped in `v.object(...)` — Convex accepts
 * a raw record of validators as the `args:` field.
 *
 * With a sharing context, emits `commentFields.body` references where leaves
 * match. Spread (`...commentFields`) is also attempted when the args record
 * is a *superset* of a model's fields.
 */
export function convexArgsToSource(args: Record<string, unknown>, ctx?: SharingContext): string {
  const entries = Object.entries(args)
  if (entries.length === 0) return '{}'

  // Try whole/partial spread of any model whose fields are a subset of args.
  const spreadMatches = ctx ? findSpreadMatch(args, ctx) : undefined

  const renderedFields: string[] = []
  const consumed = new Set(spreadMatches?.consumed ?? [])

  for (const [k, val] of entries) {
    if (consumed.has(k)) continue
    renderedFields.push(`${quoteKey(k)}: ${convexValidatorToSource(val, ctx, k)}`)
  }

  const spreads = spreadMatches?.spreads ?? []
  const parts = [...renderedFields, ...spreads]
  return parts.length === 0 ? '{}' : `{ ${parts.join(', ')} }`
}

/**
 * For a record of fields, find any model whose entire `*Fields` set matches a
 * subset of these fields. Returns the spread expressions to emit and the set
 * of consumed field names. Greedy: largest match first.
 */
function findSpreadMatch(
  record: Record<string, unknown>,
  ctx: SharingContext
): { spreads: string[]; consumed: Set<string> } | undefined {
  const recordKeys = new Map<string, string>()
  for (const [k, v] of Object.entries(record)) {
    recordKeys.set(k, structuralKey(v))
  }

  // Sort models by size descending — bigger spreads are more useful.
  // Restrict to preferred records when set, same scoping rule as named leaves.
  const candidates = ctx.preferredRecordNames
    ? ctx.models.filter(m => ctx.preferredRecordNames!.has(m.fieldsRecordName))
    : ctx.models
  const sorted = [...candidates].sort((a, b) => b.fieldKeys.size - a.fieldKeys.size)

  const consumed = new Set<string>()
  const spreads: string[] = []
  for (const model of sorted) {
    if (model.fieldKeys.size === 0) continue
    let matches = true
    for (const [fname, fkey] of model.fieldKeys) {
      if (consumed.has(fname)) {
        matches = false
        break
      }
      if (recordKeys.get(fname) !== fkey) {
        matches = false
        break
      }
    }
    if (!matches) continue
    spreads.push(`...${model.fieldsRecordName}`)
    ctx.usedRecords.add(model.fieldsRecordName)
    for (const fname of model.fieldKeys.keys()) {
      consumed.add(fname)
    }
  }

  return spreads.length === 0 ? undefined : { spreads, consumed }
}

function serializeBase(v: ConvexValidator, ctx?: SharingContext): string {
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
      return `v.array(${convexValidatorToSource(v.element, ctx)})`
    case 'object': {
      const fields = (v.fields ?? {}) as Record<string, unknown>
      return `v.object(${convexArgsToSource(fields, ctx)})`
    }
    case 'union': {
      const members = (v.members ?? []) as unknown[]
      if (members.length === 0) return 'v.any() /* empty union */'
      if (members.length === 1) return convexValidatorToSource(members[0], ctx)
      const body = members.map(m => convexValidatorToSource(m, ctx)).join(', ')
      return `v.union(${body})`
    }
    case 'record': {
      const rec = v as unknown as { key: unknown; value: unknown }
      return `v.record(${convexValidatorToSource(rec.key, ctx)}, ${convexValidatorToSource(rec.value, ctx)})`
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
