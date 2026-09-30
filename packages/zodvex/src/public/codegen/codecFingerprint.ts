import { $ZodCodec, type $ZodType } from '../../internal/zod-core'
import { schemaShapeSource } from './schemaShapeSource'

/**
 * Produces a structural fingerprint for a ZodCodec by serializing its
 * wire (in) and runtime (out) schemas. Two factory-created codec instances
 * with the same arguments produce the same fingerprint, enabling dedup
 * even when object identity differs.
 *
 * The wire/runtime schemas are serialized via the pinned shape-only policy, then suffixed
 * with a stable representation of any checks (`.max(n)`, `.min(n)`, etc.)
 * so that `sensitive(z.string())` and `sensitive(z.string().max(100))`
 * land on distinct fingerprints. Without this, codecs that differ only by
 * a constraint collide and the ambiguity-resolution path can't tell them
 * apart by structure alone.
 *
 * The transform bodies (decode/encode) are folded in too: two codecs with the
 * same wire+runtime shape but different transform logic must NOT share a
 * fingerprint, or the ambiguity path could reference a behaviorally-wrong
 * codec. `.toString()` discriminates transform source (a residual gap remains
 * for identical source with different captured closure config — documented).
 */
export function fingerprintCodec(schema: $ZodType): string {
  if (!(schema instanceof $ZodCodec)) return ''
  const def = schema._zod.def as {
    in: $ZodType
    out: $ZodType
    transform?: unknown
    reverseTransform?: unknown
  }
  const transform = typeof def.transform === 'function' ? def.transform.toString() : ''
  const reverse = typeof def.reverseTransform === 'function' ? def.reverseTransform.toString() : ''
  return `${fingerprintLeaf(def.in)}|${fingerprintLeaf(def.out)}|${transform}|${reverse}`
}

function fingerprintLeaf(schema: $ZodType): string {
  return `${schemaShapeSource(schema)}#${fingerprintChecks(schema)}`
}

function fingerprintChecks(schema: $ZodType): string {
  const checks = (schema as any)?._zod?.def?.checks
  if (!Array.isArray(checks) || checks.length === 0) return ''
  const parts: string[] = []
  for (const check of checks) {
    const def = (check as any)?._zod?.def
    if (!def) continue
    const checkType = def.check ?? def.type ?? 'check'
    // Stringify only the data that distinguishes one check from another —
    // numeric bounds, regex sources, format names. Skip non-serializable
    // fields (functions, error contributors) so the fingerprint stays stable.
    const data: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(def)) {
      if (k === 'check' || k === 'type' || k === 'error' || k === 'message') continue
      const t = typeof v
      if (t === 'string' || t === 'number' || t === 'boolean' || v === null) {
        data[k] = v
      } else if (v instanceof RegExp) {
        data[k] = v.source
      }
    }
    parts.push(`${checkType}(${JSON.stringify(data)})`)
  }
  return parts.sort().join('&')
}
