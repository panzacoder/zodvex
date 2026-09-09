import type { z } from 'zod'
import { makeWire, SecretText } from './shape'

export function exercise(
  schema: z.ZodType, width: number,
  decode: (schema: z.ZodType, value: unknown) => unknown,
  encode: (schema: z.ZodType, value: unknown) => unknown,
) {
  const wire = makeWire(width)
  const decoded = decode(schema, wire) as Record<string, unknown>
  if (!(decoded.f0 instanceof Date) || !(decoded.f1 instanceof SecretText))
    throw new Error('Top-level codec decode failed')
  const dated = decoded.f2 as { kind: string; at: Date }
  const text = decoded.f6 as { kind: string; secret: SecretText }
  if (dated.kind !== 'dated' || !(dated.at instanceof Date) ||
      text.kind !== 'text' || !(text.secret instanceof SecretText))
    throw new Error('Nested union codec decode failed')
  decoded.f0 = new Date(decoded.f0.getTime() + 1000)
  decoded.f1 = new SecretText(decoded.f1.toWire().toUpperCase())
  dated.at = new Date(dated.at.getTime() + 2000)
  const encoded = encode(schema, decoded) as Record<string, unknown>
  const expected = { ...wire, f0: 1700000001000, f1: 'ITEM-1',
    f2: { kind: 'dated', at: 1700000002002 } }
  if (JSON.stringify(encoded) !== JSON.stringify(expected))
    throw new Error('Codec round trip changed wire values')
  let invalidInputRejected = false
  try { decode(schema, { ...wire, f0: 'invalid timestamp' }) }
  catch { invalidInputRejected = true }
  let invalidUnionRejected = false
  try { decode(schema, { ...wire, f2: { kind: 'dated', at: 'invalid timestamp' } }) }
  catch { invalidUnionRejected = true }
  let wireValidInvalidInputRejected = false
  try { decode(schema, { ...wire, f0: 1e100 }) }
  catch { wireValidInvalidInputRejected = true }
  let invalidOutputRejected = false
  try { encode(schema, { ...decoded, f0: 'not a Date' }) }
  catch { invalidOutputRejected = true }
  if (!invalidInputRejected || !invalidUnionRejected || !invalidOutputRejected || !wireValidInvalidInputRejected)
    throw new Error('Codec validation accepted an invalid value')
  return {
    date: encoded.f0 as number, secret: encoded.f1 as string,
    nestedDate: (encoded.f2 as { at: number }).at,
    nestedSecret: text.secret.toWire(), arrayNumber: (encoded.f3 as number[])[1],
    roundTrip: true, invalidInputRejected, invalidUnionRejected, invalidOutputRejected, wireValidInvalidInputRejected,
  }
}
