import { expect, it } from 'vitest'
import { z } from 'zod'
import { fingerprintCodec } from '../src/public/codegen/codecFingerprint'

const transforms = {
  decode: (value: unknown) => value,
  encode: (value: unknown) => value
}

it('preserves shape-only fingerprint equivalence when nested checks differ', () => {
  const plain = z.codec(z.object({ name: z.string() }), z.string(), transforms)
  const bounded = z.codec(z.object({ name: z.string().max(10) }), z.string(), transforms)

  // Existing matching deliberately omits nested checks. Emission fidelity can
  // improve independently; changing this equivalence needs a separate decision.
  expect(fingerprintCodec(plain)).toMatch(
    /^z\.object\(\{ name: z\.string\(\) \}\)#\|z\.string\(\)#\|/
  )
  expect(fingerprintCodec(bounded)).toBe(fingerprintCodec(plain))
})

it('retains root checks and distinguishes different transforms', () => {
  const bounded = z.codec(z.string().max(10), z.string(), transforms)
  expect(fingerprintCodec(bounded).split('|').slice(0, 2)).toEqual([
    'z.string()#max_length({"maximum":10})',
    'z.string()#'
  ])

  const plain = z.codec(z.string(), z.string(), transforms)
  const upper = z.codec(z.string(), z.string(), {
    decode: value => value.toUpperCase(),
    encode: value => value.toLowerCase()
  })
  expect(fingerprintCodec(bounded)).not.toBe(fingerprintCodec(plain))
  expect(fingerprintCodec(upper)).not.toBe(fingerprintCodec(plain))
})
