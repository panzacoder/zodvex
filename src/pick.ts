import { z } from 'zod'
import { getObjectShape } from './mapping'

type Mask = readonly string[] | Record<string, boolean | 1 | true>

function toKeys(mask: Mask): string[] {
  if (Array.isArray(mask)) return mask.map(String)
  return Object.keys(mask).filter((k) => !!(mask as any)[k])
}

// Returns a plain shape object containing only the selected fields.
// Accepts either a ZodObject or a raw shape object.
export function pickShape(
  schemaOrShape: z.ZodObject<any> | Record<string, any>,
  mask: Mask
): Record<string, any> {
  const keys = toKeys(mask)
  const shape = schemaOrShape instanceof z.ZodObject
    ? getObjectShape(schemaOrShape)
    : (schemaOrShape || {})

  const out: Record<string, any> = {}
  for (const k of keys) {
    if (k in shape) out[k] = (shape as any)[k]
  }
  return out
}

// Builds a fresh Zod object from the selected fields (avoids Zod's .pick())
export function safePick(
  schema: z.ZodObject<any>,
  mask: Mask
): z.ZodObject<any> {
  return z.object(pickShape(schema, mask))
}

// Convenience: omit a set of keys by building the complement
export function safeOmit(
  schema: z.ZodObject<any>,
  mask: Mask
): z.ZodObject<any> {
  const shape = getObjectShape(schema)
  const omit = new Set(toKeys(mask))
  const keep = Object.keys(shape).filter((k) => !omit.has(k))
  const picked = pickShape(schema, keep)
  return z.object(picked)
}

