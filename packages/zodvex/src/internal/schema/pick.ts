import { z } from 'zod'
import { getObjectShape } from './objectShape'

type Mask = readonly string[] | Record<string, boolean | 1 | true>

// Type alias — keeps z.ZodObject off {-ending function signature lines (formatter-safe). // zod-ok
type AnyZodObject = z.ZodObject<any> // zod-ok

function toKeys(mask: Mask): string[] {
  if (Array.isArray(mask)) return mask.map(String)
  return Object.keys(mask).filter(k => !!(mask as any)[k])
}

export function pickShape(
  schemaOrShape: AnyZodObject | Record<string, any>,
  mask: Mask
): Record<string, any> {
  const keys = toKeys(mask)
  const shape =
    schemaOrShape instanceof z.ZodObject ? getObjectShape(schemaOrShape) : schemaOrShape || {}

  const out: Record<string, any> = {}
  for (const k of keys) {
    if (k in shape) out[k] = (shape as any)[k]
  }
  return out
}

export function safePick(schema: AnyZodObject, mask: Mask): AnyZodObject {
  return z.object(pickShape(schema, mask))
}

export function safeOmit(schema: AnyZodObject, mask: Mask): AnyZodObject {
  const shape = getObjectShape(schema)
  const omit = new Set(toKeys(mask))
  const keep = Object.keys(shape).filter(k => !omit.has(k))
  const picked = pickShape(schema, keep)
  return z.object(picked)
}
