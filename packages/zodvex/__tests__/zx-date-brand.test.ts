import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { zx } from '../src/internal/zx'
import { isZxDateCodec } from '../src/internal/zxDateBrand'
import { findCodec } from '../src/public/codegen/extractCodec'
import { zodToSource } from '../src/public/codegen/zodToSource'

/** A user codec with the same structural shape as zx.date() (issue #100). */
function moneyCodec() {
  return z.codec(
    z.number(),
    z.custom<{ cents: number }>(v => typeof v === 'object'),
    {
      decode: (n: number) => ({ cents: n }),
      encode: (m: { cents: number }) => m.cents
    }
  )
}

describe('isZxDateCodec', () => {
  it('is true for zx.date()', () => {
    expect(isZxDateCodec(zx.date())).toBe(true)
  })

  it('is false for a structurally identical user codec', () => {
    expect(isZxDateCodec(moneyCodec())).toBe(false)
  })

  it('is false for non-schemas', () => {
    expect(isZxDateCodec(undefined)).toBe(false)
    expect(isZxDateCodec({})).toBe(false)
    expect(isZxDateCodec(z.number())).toBe(false)
  })
})

describe('codegen detection (issue #100)', () => {
  it('findCodec skips zx.date() but returns a shape-alike user codec', () => {
    const money = moneyCodec()
    expect(findCodec(zx.date())).toBeUndefined()
    expect(findCodec(money)).toBe(money)
    // Wrapped forms behave the same.
    expect(findCodec(zx.date().optional() as any)).toBeUndefined()
  })

  it('zodToSource emits zx.date() only for branded codecs', () => {
    expect(zodToSource(zx.date() as any)).toBe('zx.date()')

    // A shape-alike codec must NOT serialize as zx.date(). Without a codecMap
    // it falls back to the wire schema with a lost-transform marker — wrong
    // would be silently decoding to Date.
    const source = zodToSource(moneyCodec() as any)
    expect(source).not.toBe('zx.date()')
    expect(source).toContain('z.number()')
  })
})
