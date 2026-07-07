/**
 * Runtime brand for codecs created by zx.date().
 *
 * zx.date() used to be detected structurally ($ZodCodec with in=$ZodNumber,
 * out=$ZodCustom), which misidentified any user codec of the same shape —
 * e.g. a money codec `z.codec(z.number(), z.custom<{cents}>(), …)` — as a
 * date: toJSONSchema emitted date-time for it, and codegen serialized the
 * field as `zx.date()`, decoding to the wrong runtime type (#100).
 *
 * Symbol.for makes the brand identical across build artifacts (the full and
 * mini bundles each carry their own copy of this module). The brand is set
 * on both the codec instance and its `_zod.def`, enumerably, so it survives
 * wrapper operations that reuse or shallow-copy the def.
 *
 * Lives in its own dependency-free module: it's needed by internal/zx.ts,
 * internal/registry.ts, and the codegen pipeline, which must not import each
 * other.
 */
const ZX_DATE_BRAND = Symbol.for('zodvex.zxDate')

/** @internal Marks a freshly constructed zx.date() codec. */
export function brandZxDate<T extends object>(codec: T): T {
  ;(codec as any)[ZX_DATE_BRAND] = true
  const def = (codec as any)._zod?.def
  if (def) def[ZX_DATE_BRAND] = true
  return codec
}

/** Returns true iff the schema is a codec created by zx.date(). */
export function isZxDateCodec(schema: unknown): boolean {
  if (!schema || typeof schema !== 'object') return false
  const s = schema as any
  return s[ZX_DATE_BRAND] === true || s._zod?.def?.[ZX_DATE_BRAND] === true
}
