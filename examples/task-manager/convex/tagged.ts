import { z } from 'zod'
import { zx } from 'zodvex/core'

/**
 * Tagged codec factory — wraps any value with a { value, tag } wire format.
 *
 * Each call creates a NEW ZodCodec instance (like a consumer's `custom()`).
 * This is the pattern that breaks codegen discovery, which only finds
 * module-level exports.
 */
export function tagged<T extends z.ZodTypeAny>(inner: T) {
  const wireSchema = z.object({
    value: inner,
    tag: z.string(),
  })

  const runtimeSchema = z.object({
    value: inner,
    tag: z.string(),
    displayValue: z.string(),
  })

  return zx.codec(wireSchema, runtimeSchema, {
    decode: (wire: z.output<typeof wireSchema>) => ({
      ...wire,
      displayValue: `[${wire.tag}] ${wire.value}`,
    }),
    encode: (runtime: z.output<typeof runtimeSchema>) => ({
      value: runtime.value,
      tag: runtime.tag,
    }),
  })
}
