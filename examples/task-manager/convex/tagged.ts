import { z } from 'zod'
import { zx } from 'zodvex'

/**
 * Tagged codec factory — wraps any value with a { value, tag } wire format.
 *
 * Each call creates a NEW ZodCodec instance (like a consumer's `custom()`), so
 * codegen can't identity-match an inline call to an exported twin. The `brand`
 * (`tagged:<name>`) gives each instance a *declared* identity, so codegen
 * resolves an inline `tagged(z.string(), "email")` to the exported `taggedEmail`
 * precisely — no structural guessing, no cross-factory collisions. See
 * docs/decisions/2026-06-08-codec-provenance-brands.md.
 */
export function tagged<T extends z.ZodTypeAny>(inner: T, name: string) {
  const wireSchema = z.object({
    value: inner,
    tag: z.string(),
  })

  const runtimeSchema = z.object({
    value: inner,
    tag: z.string(),
    displayValue: z.string(),
  })

  // any casts: generic T causes z.input<T> vs z.output<T> mismatch that TS can't resolve.
  // Tracked as a dedicated task for tighter constraints on codec factory generics.
  return zx.codec(
    wireSchema,
    runtimeSchema,
    {
      decode: (wire: any) => ({
        ...wire,
        displayValue: `[${wire.tag}] ${wire.value}`,
      }),
      encode: (runtime: any) => ({
        value: runtime.value,
        tag: runtime.tag,
      }),
    },
    { brand: `tagged:${name}` },
  )
}

/**
 * Stable, branded codec instances for tagged emails and tags. Exported so
 * codegen identity-matches references across model and function files; the
 * brand additionally lets codegen resolve *inline* `tagged(...)` calls (fresh
 * instances) back to these exports by declared identity. Distinct brands
 * (`tagged:email` vs `tagged:tag`) keep the two from being conflated even
 * though their wire shapes are identical.
 */
export const taggedEmail = tagged(z.string(), 'email')
export const taggedTag = tagged(z.string(), 'tag')
