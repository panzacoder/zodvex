// Historical experiment only: FAILED current boundary compatibility. See README.md.
import { createHash } from 'node:crypto'
import { $ZodArray, $ZodCodec, $ZodDiscriminatedUnion, $ZodLazy, $ZodLiteral,
  $ZodNullable, $ZodObject, $ZodOptional, $ZodPipe, $ZodRecord, $ZodString,
  $ZodTransform, $ZodTuple, $ZodType, $ZodUnion } from 'zod/v4/core'
import { zx } from 'zodvex'
import { isZxDateCodec } from '../../../packages/zodvex/src/internal/zxDateBrand'
import type { DiscoveredModel } from '../../../packages/zodvex/src/public/codegen/discover'
import { type ZodToSourceContext, zodToSource } from './historical-zod-to-source'
const HEADER = '// Historical PR80 generated descriptor; experimental and incompatible with current full-read contract\n'
type CodecForGeneration = { exportName: string; sourceFile: string; schema: $ZodType }

export function schemaSubtreeHasCodec(schema: $ZodType, seen: Set<$ZodType> = new Set()): boolean {
  if (seen.has(schema)) return false
  seen.add(schema)
  if (schema instanceof $ZodCodec) return true
  if (schema instanceof $ZodLazy) {
    // The child sits behind def.getter (a function), invisible to the
    // generic def walk below; `seen` guards recursive schemas. A getter
    // that throws can't be inspected — report true so callers take their
    // conservative (fallback) path rather than silently missing a codec.
    try {
      const inner = (schema as any)._zod.def.getter()
      return inner instanceof $ZodType ? schemaSubtreeHasCodec(inner, seen) : false
    } catch {
      return true
    }
  }
  const def = (schema as any)._zod?.def
  if (!def) return false
  for (const value of Object.values(def)) {
    if (value instanceof $ZodType && schemaSubtreeHasCodec(value, seen)) return true
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item instanceof $ZodType && schemaSubtreeHasCodec(item, seen)) return true
      }
    } else if (value && typeof value === 'object') {
      for (const item of Object.values(value)) {
        if (item instanceof $ZodType && schemaSubtreeHasCodec(item, seen)) return true
      }
    }
  }
  return false
}

// Model descriptors ("codec-paths") — _zodvex/models/<table>.js + index
//
// One descriptor per CODEC-BEARING table: a minimal loose zod schema holding
// only the codec fields (unknown keys pass through untouched), consumed by
// the db wrapper as an ordinary ZodTableSchemas entry. The statically-
// imported index is the central tableMap at O(codec fields) eval cost
// instead of O(model graph) — the design proven in
// examples/stress-test/results/codec-paths-spike-2026-06-12.md (codecs at
// pure-convex parity vs OOM at ~150 models for the all-models map).
//
// Tables whose codecs the path format can't address (codec inside a union/
// record/tuple, or a custom codec with no importable reference) FALL BACK to
// importing their full model — a per-table cost, never a cliff.
// ---------------------------------------------------------------------------

export interface ModelDescriptorFile {
  /** File name under _zodvex/models/, without extension. */
  name: string
  js: string
  dts: string
}

export interface ModelDescriptorsOutput {
  files: ModelDescriptorFile[]
  indexJs: string
  indexDts: string
  /** Tables whose WHOLE descriptor (doc + insert) imports the full model. */
  fallbacks: { tableName: string; reason: string }[]
  /**
   * Tables whose `insert` descriptor falls back to the full model for
   * write-side refinement enforcement (a non-serializable .refine()/.check(fn)/
   * .transform()); their `doc` stays codec-only minimal. Surfaced as a
   * generate-time warning so the cost is loud.
   */
  insertFallbacks: { tableName: string; reason: string }[]
}

/**
 * Recursively emits the MINIMAL schema source for a zod schema: only the
 * subtrees that contain codecs survive; everything else passes through via
 * loose objects. Returns:
 *  - a source string when the subtree contains codecs,
 *  - null when it contains none (caller omits it — passthrough is correct),
 *  - { unsupported } when a codec sits somewhere the minimal format cannot
 *    address (non-discriminated union branch, record value, tuple slot).
 *
 * Discriminated unions ARE supported: each codec-bearing branch becomes a
 * loose object of its codec fields PLUS its required discriminator literal,
 * and a final empty loose object catches codec-free branches (passthrough).
 */
/**
 * For a plain union of object branches: find a key present in EVERY branch
 * as a $ZodLiteral with pairwise-distinct values — a de-facto discriminator.
 */
function inferDiscriminator(options: $ZodType[]): string | undefined {
  const objectBranches = options.filter((o): o is $ZodObject => o instanceof $ZodObject)
  if (objectBranches.length !== options.length || objectBranches.length === 0) return undefined
  const literalKeys = (branch: $ZodObject): Map<string, unknown> => {
    const out = new Map<string, unknown>()
    const shape = (branch as any)._zod.def.shape as Record<string, $ZodType>
    for (const [k, v] of Object.entries(shape ?? {})) {
      if (v instanceof $ZodLiteral) {
        const values = (v as any)._zod?.def?.values
        if (Array.isArray(values) && values.length === 1) out.set(k, values[0])
      }
    }
    return out
  }
  const perBranch = objectBranches.map(literalKeys)
  for (const key of perBranch[0].keys()) {
    const values = perBranch.map(m => (m.has(key) ? m.get(key) : undefined))
    if (values.some(v => v === undefined)) continue
    if (new Set(values.map(v => JSON.stringify(v))).size === values.length) return key
  }
  return undefined
}

type MinimalEmit = string | null | { unsupported: string }

function isUnsupported(e: MinimalEmit): e is { unsupported: string } {
  return typeof e === 'object' && e !== null
}

function emitMinimalSchema(
  schema: $ZodType,
  codecRef: (codec: $ZodType) => string | null,
  at: string
): MinimalEmit {
  if (schema instanceof $ZodCodec) {
    // Brand check, never structural: a user codec with the same in/out shape
    // (number → custom, e.g. Money-in-cents) must resolve a ref or fall
    // back — inlining zx.date() for it would decode cents into Dates (#100).
    if (isZxDateCodec(schema)) return 'zx.date()'
    const ref = codecRef(schema)
    return (
      ref ?? { unsupported: `custom codec without an importable standalone reference at ${at}` }
    )
  }
  if (schema instanceof $ZodOptional) {
    const inner = emitMinimalSchema((schema as any)._zod.def.innerType, codecRef, at)
    if (inner === null || isUnsupported(inner)) return inner
    return `z.optional(${inner})`
  }
  if (schema instanceof $ZodNullable) {
    const inner = emitMinimalSchema((schema as any)._zod.def.innerType, codecRef, at)
    if (inner === null || isUnsupported(inner)) return inner
    return `z.nullable(${inner})`
  }
  if (schema instanceof $ZodObject) {
    // Shape-keys-only emit: a codec hiding in the catchall would be
    // silently dropped from the tableMap — fall back instead.
    const catchall = (schema as any)._zod.def.catchall
    if (catchall instanceof $ZodType && schemaSubtreeHasCodec(catchall)) {
      return { unsupported: `codec inside object catchall at ${at}` }
    }
    const shape = (schema as any)._zod.def.shape as Record<string, $ZodType>
    const lines: string[] = []
    for (const key of Object.keys(shape ?? {}).sort()) {
      const emitted = emitMinimalSchema(shape[key], codecRef, `${at}.${key}`)
      if (isUnsupported(emitted)) return emitted
      if (emitted !== null) lines.push(`${key}: ${emitted},`)
    }
    if (lines.length === 0) return null
    return `z.looseObject({ ${lines.join(' ')} })`
  }
  if (schema instanceof $ZodArray) {
    const inner = emitMinimalSchema((schema as any)._zod.def.element, codecRef, `${at}[*]`)
    if (inner === null || isUnsupported(inner)) return inner
    return `z.array(${inner})`
  }
  if (schema instanceof $ZodUnion) {
    // Covers $ZodDiscriminatedUnion (a subclass) AND plain unions whose
    // discriminated-ness was erased (addSystemFields rebuilds doc unions
    // via plain z.union). For plain unions we INFER the discriminator: a
    // key every object branch carries as a literal, with distinct values.
    const def = (schema as any)._zod.def
    const options: $ZodType[] = def.options ?? []
    if (!schemaSubtreeHasCodec(schema)) return null
    const discriminator: string | undefined =
      schema instanceof $ZodDiscriminatedUnion
        ? (def.discriminator as string)
        : inferDiscriminator(options)
    if (discriminator === undefined) {
      return { unsupported: `codec inside union without an inferable discriminator at ${at}` }
    }
    const branches: string[] = []
    let any = false
    for (let i = 0; i < options.length; i++) {
      const branch = options[i]
      if (!(branch instanceof $ZodObject)) {
        if (schemaSubtreeHasCodec(branch)) {
          return { unsupported: `codec inside non-object union branch at ${at}` }
        }
        continue
      }
      const emitted = emitMinimalSchema(branch, codecRef, `${at}<${i}>`)
      if (isUnsupported(emitted)) return emitted
      if (emitted === null) continue
      any = true
      // The branch's minimal schema must carry its discriminator literal so
      // decode applies the right branch's codecs.
      const shape = (branch as any)._zod.def.shape as Record<string, $ZodType>
      const disc = shape?.[discriminator]
      const value = (disc as any)?._zod?.def?.values?.[0]
      if (!(disc instanceof $ZodLiteral) || value === undefined) {
        return { unsupported: `codec union branch without literal discriminator at ${at}` }
      }
      // Inject the discriminator into the emitted loose object.
      branches.push(
        emitted.replace(
          'z.looseObject({ ',
          `z.looseObject({ ${discriminator}: z.literal(${JSON.stringify(value)}), `
        )
      )
    }
    if (!any) return null
    // Codec-free branches (and anything unexpected) pass through untouched.
    branches.push('z.looseObject({})')
    return `z.union([${branches.join(', ')}])`
  }
  if (schema instanceof $ZodRecord || schema instanceof $ZodTuple) {
    if (schemaSubtreeHasCodec(schema)) {
      const kind = schema instanceof $ZodRecord ? 'record' : 'tuple'
      return { unsupported: `codec inside ${kind} at ${at}` }
    }
    return null
  }
  if (schema instanceof $ZodLazy) {
    // Descriptors are static source — a lazy (possibly recursive) subtree
    // can't be re-emitted structurally. With a codec beneath, fall back to
    // the full model; codec-free lazy subtrees pass through untouched.
    if (schemaSubtreeHasCodec(schema)) {
      return { unsupported: `codec inside a z.lazy subtree at ${at}` }
    }
    return null
  }
  // Other wrappers: descend a single inner schema slot conservatively.
  const def = (schema as any)._zod?.def
  if (def?.innerType instanceof $ZodType) {
    return emitMinimalSchema(def.innerType, codecRef, at)
  }
  if (schemaSubtreeHasCodec(schema)) {
    return { unsupported: `codec inside unsupported node at ${at}` }
  }
  return null
}

// ---------------------------------------------------------------------------
// Insert-side refinement enforcement.
//
// The `doc` descriptor stays codec-only minimal (permissive reads). The
// `insert` descriptor ALSO carries every SERIALIZABLE built-in check on
// non-codec fields, so z.encode (run by the db write path) enforces them on
// handler-constructed db.insert/patch/replace values. Custom .refine()/
// .check(fn)/.transform() are arbitrary closures — not expressible as
// standalone source — so a table carrying one falls its `insert` back to
// importing the full model (doc stays minimal).
// ---------------------------------------------------------------------------

// String-format `format` names that map 1:1 to a top-level factory present in
// BOTH full zod and zod/mini (verified), usable as `.check(z.<name>())`.
const NAMED_STRING_FORMATS = new Set([
  'email',
  'url',
  'uuid',
  'guid',
  'emoji',
  'nanoid',
  'cuid',
  'cuid2',
  'ulid',
  'xid',
  'ksuid',
  'ipv4',
  'ipv6',
  'cidrv4',
  'cidrv6',
  'base64',
  'base64url',
  'e164',
  'jwt'
])

function numericLiteral(v: unknown): string | null {
  if (typeof v === 'bigint') return `${v}n`
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return null
}

function regexLiteral(pattern: RegExp): string {
  return pattern.flags
    ? `new RegExp(${JSON.stringify(pattern.source)}, ${JSON.stringify(pattern.flags)})`
    : `new RegExp(${JSON.stringify(pattern.source)})`
}

/**
 * Serializes ONE zod check to a top-level factory call usable inside
 * `.check(...)` in both full zod and zod/mini. Returns null for checks that
 * are arbitrary closures (`.refine()`/`.check(fn)`), mutating (`.trim()`),
 * or otherwise not expressible as standalone source — the caller treats null
 * as "this insert subtree must fall back to the full model".
 */
function serializeCheck(check: unknown): string | null {
  const def = (check as any)?._zod?.def
  if (!def) return null
  switch (def.check) {
    case 'greater_than': {
      const v = numericLiteral(def.value)
      return v == null ? null : def.inclusive ? `z.gte(${v})` : `z.gt(${v})`
    }
    case 'less_than': {
      const v = numericLiteral(def.value)
      return v == null ? null : def.inclusive ? `z.lte(${v})` : `z.lt(${v})`
    }
    case 'min_length': {
      const v = numericLiteral(def.minimum)
      return v == null ? null : `z.minLength(${v})`
    }
    case 'max_length': {
      const v = numericLiteral(def.maximum)
      return v == null ? null : `z.maxLength(${v})`
    }
    case 'length_equals': {
      const v = numericLiteral(def.length)
      return v == null ? null : `z.length(${v})`
    }
    case 'multiple_of': {
      const v = numericLiteral(def.value)
      return v == null ? null : `z.multipleOf(${v})`
    }
    case 'number_format':
      // Only integer formats round-trip as a factory; float formats (and any
      // future kind) fall back so we never silently drop enforcement.
      return def.format === 'safeint' || def.format === 'int' ? 'z.int()' : null
    case 'string_format': {
      if (typeof def.format === 'string' && NAMED_STRING_FORMATS.has(def.format)) {
        return `z.${def.format}()`
      }
      if (def.pattern instanceof RegExp) return `z.regex(${regexLiteral(def.pattern)})`
      return null
    }
    // 'custom' (refine/superRefine/check(fn)), 'overwrite' (.trim()/.toLowerCase()),
    // and any unrecognized kind are non-serializable → force fallback.
    default:
      return null
  }
}

/**
 * A `zx.id('table')` is a $ZodString carrying a `custom` (id-shape) check, but
 * it is NOT a value refinement — the read (`doc`) descriptor drops it as a
 * passthrough field, so the write (`insert`) descriptor must too. Without this
 * its `custom` check would force every foreign-key-bearing table into a
 * full-model insert fallback (the weight cliff). Detection mirrors zodToSource.
 */
function isZid(schema: $ZodType): boolean {
  if (!(schema instanceof $ZodString)) return false
  const s = schema as any
  if (s._tableName != null) return true
  return typeof s.description === 'string' && s.description.startsWith('convexId:')
}

const CHECKS_UNSUPPORTED = Symbol('checks-unsupported')

/**
 * Builds the `.check(...)` suffix for a schema's OWN checks. Returns '' when
 * there are none, the suffix when ALL checks serialize, or CHECKS_UNSUPPORTED
 * when any check is a non-serializable closure/transform.
 */
function emitOwnChecks(schema: $ZodType): string | typeof CHECKS_UNSUPPORTED {
  const checks = (schema as any)?._zod?.def?.checks
  if (!Array.isArray(checks) || checks.length === 0) return ''
  const factories: string[] = []
  for (const check of checks) {
    const src = serializeCheck(check)
    if (src == null) return CHECKS_UNSUPPORTED
    factories.push(src)
  }
  return `.check(${factories.join(', ')})`
}

/**
 * True when any NON-codec node in the subtree carries a check. Codec nodes are
 * skipped (emitted by reference; their internal checks are irrelevant), so a
 * codec-only model reports false and its insert descriptor is byte-identical
 * to its doc descriptor — the weight win is preserved unchanged.
 */
function subtreeHasEnforceableCheck(schema: $ZodType, seen: Set<$ZodType> = new Set()): boolean {
  if (seen.has(schema)) return false
  seen.add(schema)
  if (schema instanceof $ZodCodec) return false
  if (isZid(schema)) return false
  const def = (schema as any)?._zod?.def
  if (!def) return false
  const checks = def.checks
  if (Array.isArray(checks) && checks.length > 0) return true
  if (schema instanceof $ZodLazy) {
    // Child hides behind def.getter (a function). A getter that throws is
    // uninspectable — report true so the caller takes the fallback rather
    // than silently dropping an enforcement it can't see.
    try {
      const inner = def.getter()
      return inner instanceof $ZodType ? subtreeHasEnforceableCheck(inner, seen) : false
    } catch {
      return true
    }
  }
  // left/right = $ZodIntersection sides; catchall = object catchall schema.
  for (const key of [
    'innerType',
    'element',
    'valueType',
    'keyType',
    'in',
    'out',
    'left',
    'right',
    'catchall'
  ]) {
    const v = def[key]
    if (v instanceof $ZodType && subtreeHasEnforceableCheck(v, seen)) return true
  }
  if (def.shape) {
    for (const v of Object.values(def.shape)) {
      if (v instanceof $ZodType && subtreeHasEnforceableCheck(v, seen)) return true
    }
  }
  for (const list of [def.options, def.items]) {
    if (Array.isArray(list)) {
      for (const v of list) {
        if (v instanceof $ZodType && subtreeHasEnforceableCheck(v, seen)) return true
      }
    }
  }
  return false
}

/**
 * True when the subtree contains a `.transform()`/pipe (NOT a codec, which is a
 * pipe-like node we emit by reference). Transforms can't round-trip a write, so
 * a table carrying one must fall its insert back to the full model.
 */
function subtreeHasTransform(schema: $ZodType, seen: Set<$ZodType> = new Set()): boolean {
  if (seen.has(schema)) return false
  seen.add(schema)
  if (schema instanceof $ZodCodec) return false
  if (schema instanceof $ZodPipe || schema instanceof $ZodTransform) return true
  const def = (schema as any)?._zod?.def
  if (!def) return false
  if (schema instanceof $ZodLazy) {
    // See subtreeHasEnforceableCheck: resolve the getter; uninspectable →
    // conservative true (fallback), never a silent drop.
    try {
      const inner = def.getter()
      return inner instanceof $ZodType ? subtreeHasTransform(inner, seen) : false
    } catch {
      return true
    }
  }
  // left/right = $ZodIntersection sides; catchall = object catchall schema.
  for (const key of [
    'innerType',
    'element',
    'valueType',
    'keyType',
    'in',
    'out',
    'left',
    'right',
    'catchall'
  ]) {
    const v = def[key]
    if (v instanceof $ZodType && subtreeHasTransform(v, seen)) return true
  }
  if (def.shape) {
    for (const v of Object.values(def.shape)) {
      if (v instanceof $ZodType && subtreeHasTransform(v, seen)) return true
    }
  }
  for (const list of [def.options, def.items]) {
    if (Array.isArray(list)) {
      for (const v of list) {
        if (v instanceof $ZodType && subtreeHasTransform(v, seen)) return true
      }
    }
  }
  return false
}

/**
 * Emits the MINIMAL `insert` schema source: codec subtrees (as in
 * emitMinimalSchema) PLUS serializable built-in checks on non-codec fields.
 * Returns null when the subtree needs no enforcement (no codec, no check),
 * or { unsupported } when a non-serializable refinement/transform is hit so
 * the caller routes this table's insert to a full-model fallback.
 *
 * Fast path: a subtree with NO enforceable check or transform delegates to
 * emitMinimalSchema, guaranteeing byte-identical output (and identical weight)
 * to the codec-only descriptor for refinement-free models.
 */
function emitInsertSchema(
  schema: $ZodType,
  codecRef: (codec: $ZodType) => string | null,
  at: string,
  mini: boolean
): MinimalEmit {
  if (!subtreeHasEnforceableCheck(schema) && !subtreeHasTransform(schema)) {
    return emitMinimalSchema(schema, codecRef, at)
  }

  // Codecs are emitted by reference (handled identically to the doc path).
  if (schema instanceof $ZodCodec) return emitMinimalSchema(schema, codecRef, at)
  // Transforms are one-directional with no inverse — never emit; force fallback.
  if (schema instanceof $ZodPipe || schema instanceof $ZodTransform) {
    return { unsupported: `transform at ${at} — insert falls back to full model` }
  }
  if (schema instanceof $ZodOptional) {
    const inner = emitInsertSchema((schema as any)._zod.def.innerType, codecRef, at, mini)
    if (inner === null || isUnsupported(inner)) return inner
    return `z.optional(${inner})`
  }
  if (schema instanceof $ZodNullable) {
    const inner = emitInsertSchema((schema as any)._zod.def.innerType, codecRef, at, mini)
    if (inner === null || isUnsupported(inner)) return inner
    return `z.nullable(${inner})`
  }
  if (schema instanceof $ZodObject) {
    const own = emitOwnChecks(schema)
    if (own === CHECKS_UNSUPPORTED) {
      return {
        unsupported: `custom refinement on object at ${at} — insert falls back to full model`
      }
    }
    // The minimal emit below walks shape keys only — a catchall carrying a
    // check or transform would be silently dropped from enforcement.
    const catchall = (schema as any)._zod.def.catchall
    if (
      catchall instanceof $ZodType &&
      (subtreeHasEnforceableCheck(catchall) || subtreeHasTransform(catchall))
    ) {
      return {
        unsupported: `refinement inside object catchall at ${at} — insert falls back to full model`
      }
    }
    const shape = (schema as any)._zod.def.shape as Record<string, $ZodType>
    const lines: string[] = []
    for (const key of Object.keys(shape ?? {}).sort()) {
      const emitted = emitInsertSchema(shape[key], codecRef, `${at}.${key}`, mini)
      if (isUnsupported(emitted)) return emitted
      if (emitted !== null) lines.push(`${key}: ${emitted},`)
    }
    if (lines.length === 0 && own === '') return null
    return `z.looseObject({ ${lines.join(' ')} })${own}`
  }
  if (schema instanceof $ZodArray) {
    const own = emitOwnChecks(schema)
    if (own === CHECKS_UNSUPPORTED) {
      return {
        unsupported: `custom refinement on array at ${at} — insert falls back to full model`
      }
    }
    const inner = emitInsertSchema((schema as any)._zod.def.element, codecRef, `${at}[*]`, mini)
    if (isUnsupported(inner)) return inner
    if (inner === null && own === '') return null
    // Element carries no codec/check but the array has a length check: emit a
    // permissive element so the length check still enforces.
    return `z.array(${inner ?? 'z.any()'})${own}`
  }
  // Checks inside a union/record/tuple can't be placed in the minimal format —
  // fall back so enforcement is never silently dropped.
  if (schema instanceof $ZodUnion || schema instanceof $ZodRecord || schema instanceof $ZodTuple) {
    const kind =
      schema instanceof $ZodUnion ? 'union' : schema instanceof $ZodRecord ? 'record' : 'tuple'
    return { unsupported: `refinement inside ${kind} at ${at} — insert falls back to full model` }
  }
  // Single-inner wrappers (default, readonly, prefault, …): descend.
  const def = (schema as any)._zod?.def
  if (def?.innerType instanceof $ZodType) {
    return emitInsertSchema(def.innerType, codecRef, at, mini)
  }
  // Leaf (string/number/boolean/enum/literal/…) carrying checks.
  const own = emitOwnChecks(schema)
  if (own === CHECKS_UNSUPPORTED) {
    return { unsupported: `non-serializable check at ${at} — insert falls back to full model` }
  }
  if (own === '') {
    // Reached only if a check lives somewhere we couldn't place — fall back.
    return { unsupported: `refinement at ${at} — insert falls back to full model` }
  }
  const ctx: ZodToSourceContext = {
    codecMap: new Map(),
    neededCodecImports: new Map(),
    undiscoverableCodecs: [],
    mini
  }
  return `${zodToSource(schema, ctx)}${own}`
}

/**
 * Generates the per-table descriptor files + index for codec-bearing tables.
 *
 * `codecRef` resolves a custom codec instance to an importable source
 * expression (and records the import it needs); returning null triggers the
 * per-table full-model fallback.
 */
export function generateModelDescriptors(
  models: DiscoveredModel[],
  codecs?: CodecForGeneration[],
  options?: { mini?: boolean }
): ModelDescriptorsOutput {
  const mini = options?.mini === true
  const zodImport = mini ? 'zod/mini' : 'zod'
  const zodvexImport = mini ? 'zodvex/mini' : 'zodvex'

  const sorted = [...models].sort((a, b) => a.tableName.localeCompare(b.tableName))
  const files: ModelDescriptorFile[] = []
  const indexImports: string[] = []
  const indexEntries: string[] = []
  const fallbacks: { tableName: string; reason: string }[] = []
  const insertFallbacks: { tableName: string; reason: string }[] = []
  const fingerprint = createHash('sha256')

  const dtsBody = `${HEADER}
import type { $ZodType } from 'zod/v4/core'

declare const _default: { doc: $ZodType; insert: $ZodType }
export default _default
`

  for (const m of sorted) {
    // Resolve doc + insert source schemas (full models carry them; slim models
    // build via zx). `doc` drives codec-only reads; `insertSource` is the
    // writable shape whose refinements the insert descriptor must enforce.
    let doc: $ZodType | undefined
    let insertSource: $ZodType | undefined
    if (m.schemas?.doc) {
      doc = m.schemas.doc as $ZodType
      insertSource = (m.schemas.insert as $ZodType | undefined) ?? undefined
    } else if (m._modelRef) {
      doc = zx.doc(m._modelRef as any) as $ZodType
      insertSource = zx.base(m._modelRef as any) as $ZodType
    }
    if (!doc) continue

    // Custom-codec resolution: identity match against discovered standalone
    // codecs. Imports are per-file; collect them as the emitter runs.
    const neededImports = new Map<string, Set<string>>()
    const codecRef = (codec: $ZodType): string | null => {
      const hit = codecs?.find(c => c.schema === codec)
      if (!hit) return null
      const importPath = `../../${hit.sourceFile.replace(/\.ts$/, '.js')}`
      if (!neededImports.has(importPath)) neededImports.set(importPath, new Set())
      neededImports.get(importPath)!.add(hit.exportName)
      return hit.exportName
    }

    const docEmitted = emitMinimalSchema(doc, codecRef, m.tableName)
    // Insert side: codec subtrees PLUS serializable refinements. Falls back to
    // `doc` when there's no distinct writable schema.
    const insertEmitted: MinimalEmit = insertSource
      ? emitInsertSchema(insertSource, codecRef, m.tableName, mini)
      : docEmitted

    // Nothing to decode AND nothing to enforce → no descriptor (passthrough).
    if (docEmitted === null && insertEmitted === null) continue

    const importPath = `../../${m.sourceFile.replace(/\.ts$/, '.js')}`
    const isSlim = !m.schemas?.doc && !!m._modelRef

    let js: string

    if (isUnsupported(docEmitted)) {
      // Codec sits where the minimal format can't address it → the whole table
      // (doc AND insert) imports the full model. (Pre-existing behavior.)
      const reason = docEmitted.unsupported
      fallbacks.push({ tableName: m.tableName, reason })
      js = isSlim
        ? `${HEADER}
import { zx } from '${zodvexImport}'
import { ${m.exportName} } from '${importPath}'

// FALLBACK: ${reason} — this table carries its full model (per-table cost).
export default { doc: zx.doc(${m.exportName}), insert: zx.base(${m.exportName}) }
`
        : `${HEADER}
import { ${m.exportName} } from '${importPath}'

// FALLBACK: ${reason} — this table carries its full model (per-table cost).
export default { doc: ${m.exportName}.schema.doc, insert: ${m.exportName}.schema.insert }
`
      fingerprint.update(`${m.tableName}|FALLBACK;`)
    } else {
      // doc is a minimal schema (string) or null (codec-free passthrough).
      const docSrc = docEmitted ?? 'z.looseObject({})'

      // Insert side: a minimal+refinements schema, or a full-model fallback
      // when a non-serializable refinement/transform was hit. doc stays minimal.
      const insertFallback = isUnsupported(insertEmitted)
      if (insertFallback) {
        insertFallbacks.push({ tableName: m.tableName, reason: insertEmitted.unsupported })
      }
      const insertSrc = insertFallback ? '' : (insertEmitted ?? docSrc)
      const insertExpr = insertFallback
        ? isSlim
          ? `zx.base(${m.exportName})`
          : `${m.exportName}.schema.insert`
        : null

      const usesZx = /\bzx\./.test(docSrc) || (!insertFallback && /\bzx\./.test(insertSrc))
      const importLines = [
        `import { z } from '${zodImport}'`,
        ...(usesZx || (insertFallback && isSlim) ? [`import { zx } from '${zodvexImport}'`] : []),
        ...(insertFallback ? [`import { ${m.exportName} } from '${importPath}'`] : []),
        ...[...neededImports.keys()]
          .sort()
          .map(ip => `import { ${[...neededImports.get(ip)!].sort().join(', ')} } from '${ip}'`)
      ]

      if (!insertFallback && insertSrc === docSrc) {
        // doc and insert identical → single shared const, byte-identical to the
        // pre-refinement codec-only descriptor (zero weight change).
        js = `${HEADER}
${importLines.join('\n')}

// Minimal schema: codec subtrees only; unknown keys pass through (loose).
const schema = ${docSrc}

export default { doc: schema, insert: schema }
`
        fingerprint.update(`${m.tableName}|${docSrc};`)
      } else {
        // doc and insert diverge: insert carries write-side refinements (or a
        // full-model fallback). doc stays codec-only minimal (permissive reads).
        const insertDecl = insertFallback ? '' : `const insertSchema = ${insertSrc}\n`
        const insertRef = insertFallback ? insertExpr : 'insertSchema'
        js = `${HEADER}
${importLines.join('\n')}

// doc: codec subtrees only (permissive reads). insert: + write-side refinements.
const docSchema = ${docSrc}
${insertDecl}
export default { doc: docSchema, insert: ${insertRef} }
`
        fingerprint.update(
          `${m.tableName}|${docSrc}|INSERT:${insertFallback ? 'FALLBACK' : insertSrc};`
        )
      }
    }

    files.push({ name: m.tableName, js, dts: dtsBody })
    const alias = `d_${indexEntries.length}`
    indexImports.push(`import ${alias} from './${m.tableName}.js'`)
    indexEntries.push(`  '${m.tableName}': ${alias},`)
  }

  const fp = fingerprint.digest('hex')
  const indexJs = `${HEADER}
${indexImports.join('\n')}

/** Central tableMap: codec-bearing tables only at O(codec fields) cost.
 *  Tables absent here have no codecs — wrapper passthrough is correct. */
export const zodvexTableMap = {
${indexEntries.join('\n')}
}

/** Fingerprint of the codec-path spec this map was generated from. */
export const zodvexTableMapFingerprint = '${fp}'
`
  const indexDts = `${HEADER}
import type { $ZodType } from 'zod/v4/core'

export declare const zodvexTableMap: Record<string, { doc: $ZodType; insert: $ZodType }>
export declare const zodvexTableMapFingerprint: string
`
  return { files, indexJs, indexDts, fallbacks, insertFallbacks }
}
