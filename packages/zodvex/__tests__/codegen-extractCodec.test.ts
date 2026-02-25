import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { extractCodec } from '../src/codegen/extractCodec'
import { zx } from '../src/zx'

const testCodec = zx.codec(
  z.object({ value: z.string(), tag: z.string() }),
  z.object({ value: z.string(), tag: z.string(), display: z.string() }),
  {
    decode: (w: any) => ({ ...w, display: `[${w.tag}] ${w.value}` }),
    encode: (r: any) => ({ value: r.value, tag: r.tag })
  }
)

describe('extractCodec', () => {
  it('returns codec directly if no wrappers', () => {
    expect(extractCodec(testCodec)).toBe(testCodec)
  })

  it('unwraps .optional() to find codec', () => {
    expect(extractCodec(testCodec.optional())).toBe(testCodec)
  })

  it('unwraps .nullable() to find codec', () => {
    expect(extractCodec(testCodec.nullable())).toBe(testCodec)
  })

  it('unwraps .optional().nullable() to find codec', () => {
    expect(extractCodec(testCodec.optional().nullable())).toBe(testCodec)
  })

  it('unwraps double .optional() (from .partial()) to find codec', () => {
    expect(extractCodec(testCodec.optional().optional())).toBe(testCodec)
  })

  it('returns undefined for non-codec schemas', () => {
    expect(extractCodec(z.string())).toBeUndefined()
    expect(extractCodec(z.string().optional())).toBeUndefined()
  })

  it('skips zx.date() codecs', () => {
    expect(extractCodec(zx.date())).toBeUndefined()
    expect(extractCodec(zx.date().optional())).toBeUndefined()
  })
})
