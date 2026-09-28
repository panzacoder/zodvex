import { z } from 'zod'

export class SecretText {
  constructor(readonly value: string) {}
  toWire() { return this.value }
}

export function makeFields(width: number) {
  const date = () => z.codec(z.number(), z.date(), {
    decode: value => new Date(value), encode: value => value.getTime(),
  })
  const secret = () => z.codec(z.string(), z.instanceof(SecretText), {
    decode: value => new SecretText(value), encode: value => value.toWire(),
  })
  const fields: Record<string, z.ZodType> = {}
  for (let i = 0; i < width; i++) {
    switch (i % 4) {
      case 0: fields[`f${i}`] = date(); break
      case 1: fields[`f${i}`] = secret(); break
      case 2: fields[`f${i}`] = z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('dated'), at: date(), tag: z.string().optional() }),
        z.object({ kind: z.literal('text'), secret: secret() }),
      ]); break
      case 3: fields[`f${i}`] = z.array(z.union([z.string(), z.number()])); break
    }
  }
  return fields
}

export function makeWire(width: number) {
  const wire: Record<string, unknown> = {}
  for (let i = 0; i < width; i++) {
    switch (i % 4) {
      case 0: wire[`f${i}`] = 1700000000000 + i; break
      case 1: wire[`f${i}`] = `item-${i}`; break
      case 2: wire[`f${i}`] = Math.floor(i / 4) % 2 === 0
        ? { kind: 'dated', at: 1700000000000 + i }
        : { kind: 'text', secret: `item-${i}` }; break
      case 3: wire[`f${i}`] = ['entry', i]; break
    }
  }
  return wire
}
