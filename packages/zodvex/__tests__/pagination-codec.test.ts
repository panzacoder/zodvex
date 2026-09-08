import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createPaginationCodec } from '../src/internal/paginationCodec'
import { zx } from '../src/internal/zx'

const ref = { [Symbol.for('functionName')]: 'tasks:list' } as any
const args = z.object({
  after: zx.date(),
  paginationOpts: z.object({ cursor: z.string().nullable(), numItems: z.number() })
})
const returns = z.object({
  page: z.array(z.object({ at: zx.date() })),
  isDone: z.boolean(),
  continueCursor: z.string()
})

describe('pagination codec', () => {
  it('encodes filters without requiring or fabricating paginationOpts', () => {
    const codec = createPaginationCodec({ 'tasks:list': { args, returns } })
    expect(codec.encodeArgs(ref, { after: new Date(123) })).toEqual({ after: 123 })
    expect(() => codec.encodeArgs(ref, { after: 'invalid' })).toThrow()
  })
  it('decodes items and preserves item refinements', () => {
    const codec = createPaginationCodec({ 'tasks:list': { args, returns } })
    expect(codec.decodeResults(ref, [{ at: 123 }])).toEqual([{ at: new Date(123) }])
    expect(() => codec.decodeResults(ref, [{ at: 'invalid' }])).toThrow()
  })
  it('passes through functions without schemas', () => {
    const codec = createPaginationCodec({})
    const items = [{ at: 123 }]
    expect(codec.decodeResults(ref, items)).toBe(items)
    expect(codec.encodeArgs(ref, { limit: 1 })).toEqual({ limit: 1 })
  })
  it('rejects outer refinements even for an empty result', () => {
    const codec = createPaginationCodec({
      'tasks:list': { returns: returns.refine(v => v.isDone) }
    })
    expect(() => codec.decodeResults(ref, [])).toThrow(/pagination.*schema/i)
  })
  it('rejects per-page array checks instead of applying them to accumulated results', () => {
    const codec = createPaginationCodec({
      'tasks:list': { returns: z.object({ page: z.array(z.string()).max(10) }) }
    })
    expect(() => codec.decodeResults(ref, [])).toThrow(/pagination.*schema/i)
  })
  it('rejects argument object refinements rather than silently stripping them', () => {
    const codec = createPaginationCodec({
      'tasks:list': { args: args.refine(v => v.paginationOpts.numItems < 10) }
    })
    expect(() => codec.encodeArgs(ref, { after: new Date(123) })).toThrow(/pagination.*schema/i)
  })
  it('enforces refinements inside each item', () => {
    const codec = createPaginationCodec({
      'tasks:list': {
        returns: z.object({
          page: z.array(z.object({ at: zx.date() }).refine(item => item.at.getTime() > 100))
        })
      }
    })
    expect(codec.decodeResults(ref, [{ at: 123 }])).toEqual([{ at: new Date(123) }])
    expect(() => codec.decodeResults(ref, [{ at: 1 }])).toThrow()
  })
  it('rejects outer transforms instead of losing their behavior', () => {
    const codec = createPaginationCodec({
      'tasks:list': { returns: returns.transform(value => value) }
    })
    expect(() => codec.decodeResults(ref, [])).toThrow(/pagination.*schema/i)
  })
})
