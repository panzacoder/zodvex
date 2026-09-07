import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import * as mini from 'zod/mini'
import { ZodvexQueryChain } from '../src/internal/db'
import { RulesQueryChain } from '../src/internal/rules'

const variants = [
  ['full', z.object({ score: z.number(), enabled: z.boolean() })],
  ['mini', mini.object({ score: mini.number(), enabled: mini.boolean() })]
] as const

it('encodes codec values with serialize methods while preserving external native expressions', async () => {
  const { filterBuilderImpl: raw } = await import(
    '../node_modules/convex/dist/esm/server/impl/filter_builder_impl.js'
  )
  class Label {
    constructor(readonly value: string) {}
    serialize() {
      return this.value
    }
  }
  const schema = z.object({
    label: z.codec(z.string(), z.custom<Label>(value => value instanceof Label), {
      decode: value => new Label(value),
      encode: value => value.value
    }),
    score: z.number()
  })
  let actual: any
  const inner = {
    filter(predicate: any) {
      actual = predicate(raw)
      return inner
    }
  }
  const chain = new ZodvexQueryChain(inner, schema)
  chain.filter((q: any) => q.eq(q.field('label'), new Label('hello')))
  expect(actual.serialize()).toEqual({ $eq: [{ $field: 'label' }, { $literal: 'hello' }] })
  chain.filter((q: any) => q.eq(new Label('hello'), q.field('label')))
  expect(actual.serialize()).toEqual({ $eq: [{ $literal: 'hello' }, { $field: 'label' }] })
  const external = raw.add(raw.field('score'), 2)
  chain.filter((q: any) => q.eq(q.field('score'), external))
  expect(actual.serialize()).toEqual(raw.eq(raw.field('score'), external).serialize())
})

describe.each(variants)('query correctness (%s)', (_name, schema) => {
  it('preserves arithmetic, comparison, and logical expressions on either side of comparisons', async () => {
    const { filterBuilderImpl: raw } = await import(
      '../node_modules/convex/dist/esm/server/impl/filter_builder_impl.js'
    )
    let actual: any
    const inner = {
      filter(predicate: any) {
        actual = predicate(raw)
        return inner
      }
    }
    const chain = new ZodvexQueryChain(inner, schema)
    const expressions = [
      ...['add', 'sub', 'mul', 'div', 'mod'].map(op => ({
        field: 'score',
        build: (q: any) => q[op](q.field('score'), 2)
      })),
      { field: 'score', build: (q: any) => q.neg(q.field('score')) },
      ...['eq', 'neq', 'lt', 'lte', 'gt', 'gte'].map(op => ({
        field: 'enabled',
        build: (q: any) => q[op](q.field('score'), 2)
      })),
      ...['and', 'or'].map(op => ({
        field: 'enabled',
        build: (q: any) => q[op](q.field('enabled'), true)
      })),
      { field: 'enabled', build: (q: any) => q.not(q.field('enabled')) }
    ]
    for (const { field, build } of expressions) {
      for (const op of ['eq', 'neq', 'lt', 'lte', 'gt', 'gte']) {
        for (const reverse of [false, true]) {
          const predicate = (q: any) => {
            const operands = [q.field(field), build(q)]
            if (reverse) operands.reverse()
            return q[op](...operands)
          }
          chain.filter(predicate)
          expect(actual.serialize()).toEqual(predicate(raw).serialize())
        }
      }
    }
  })

  function query(rule = (_ctx: unknown, doc: any) => doc.score > 0) {
    const scanned = vi.fn()
    const closed = vi.fn()
    const readRule = vi.fn(rule)
    const inner = {
      async *[Symbol.asyncIterator]() {
        try {
          for (const score of [0, 1, 2]) {
            scanned(score)
            yield { score, enabled: true }
          }
        } finally {
          closed()
        }
      }
    }
    const chain = new RulesQueryChain(inner, schema, readRule, {})
    return { chain, scanned, closed, readRule }
  }

  it('take(0) does not start a scan or run a read rule', async () => {
    const { chain, scanned, readRule } = query()
    expect(await chain.take(0)).toEqual([])
    expect(scanned).not.toHaveBeenCalled()
    expect(readRule).not.toHaveBeenCalled()
  })

  it('take(n) stops and closes the scan immediately after n allowed documents', async () => {
    const { chain, scanned, closed, readRule } = query()
    expect(await chain.take(1)).toEqual([{ score: 1, enabled: true }])
    expect(scanned.mock.calls).toEqual([[0], [1]])
    expect(readRule).toHaveBeenCalledTimes(2)
    expect(closed).toHaveBeenCalledOnce()
  })

  it.each([
    -1,
    0.5,
    Number.NaN,
    Number.POSITIVE_INFINITY
  ])('rejects invalid take count %s before scanning', async count => {
    const { chain, scanned } = query()
    await expect(chain.take(count)).rejects.toThrow('non-negative integer')
    expect(scanned).not.toHaveBeenCalled()
  })

  it('first closes the underlying iterator', async () => {
    const { chain, closed } = query()
    expect(await chain.first()).toEqual({ score: 1, enabled: true })
    expect(closed).toHaveBeenCalledOnce()
  })

  it('breaking iteration closes the underlying iterator', async () => {
    const { chain, closed } = query()
    for await (const _doc of chain) break
    expect(closed).toHaveBeenCalledOnce()
  })

  it('a throwing read rule closes the underlying iterator', async () => {
    const failure = new Error('read denied')
    const { chain, closed } = query(() => {
      throw failure
    })
    await expect(chain.collect()).rejects.toBe(failure)
    expect(closed).toHaveBeenCalledOnce()
  })
})
