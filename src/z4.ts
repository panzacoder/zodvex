// Minimal helpers around Zod v4 core internals used by this library.
// We centralize imports and guards here so the rest of the codebase
// doesn't reach into zod/v4 directly in many places.

// Note: We still import `z` from 'zod' elsewhere for construction and parsing.
// This shim is only for reading schema internals in a v4-safe way.

export type Z4Type = any & { _zod?: { def?: { type?: string }; traits?: Set<string> } }

export function isZ4Schema(x: unknown): x is Z4Type {
  return !!(
    x &&
    typeof x === 'object' &&
    (x as any)._zod &&
    (x as any)._zod.def &&
    typeof (x as any)._zod.def.type === 'string'
  )
}

export function getDef(schema: Z4Type): { type: string; [k: string]: any } {
  return (schema as any)._zod.def
}

export function isObjectSchema(x: unknown): x is Z4Type {
  return isZ4Schema(x) && getDef(x).type === 'object'
}

export function isArraySchema(x: unknown): x is Z4Type {
  return isZ4Schema(x) && getDef(x).type === 'array'
}

export function isPipeSchema(x: unknown): x is Z4Type {
  return isZ4Schema(x) && getDef(x).type === 'pipe'
}

export function unwrapIf(
  schema: Z4Type,
  types: readonly string[]
): { schema: Z4Type; matched: boolean; def: any } {
  if (!isZ4Schema(schema)) return { schema, matched: false, def: undefined }
  const def = getDef(schema)
  if (types.includes(def.type)) {
    const inner: Z4Type = def.innerType ?? def.in ?? def.out ?? schema
    return { schema: inner, matched: true, def }
  }
  return { schema, matched: false, def }
}

