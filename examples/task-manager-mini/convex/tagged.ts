import { z } from 'zod/mini'
import { zx } from 'zodvex/core'

/**
 * Tagged codec factory — wraps any value with a { value, tag } wire format.
 *
 * Each call creates a NEW ZodCodec instance (like a consumer's `custom()`).
 * This is the pattern that breaks codegen discovery, which only finds
 * module-level exports.
 */
export function tagged<T extends z.ZodMiniType>(inner: T) {
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
  return zx.codec(wireSchema, runtimeSchema, {
    decode: (wire: any) => ({
      ...wire,
      displayValue: `[${wire.tag}] ${wire.value}`,
    }),
    encode: (runtime: any) => ({
      value: runtime.value,
      tag: runtime.tag,
    }),
  })
}
