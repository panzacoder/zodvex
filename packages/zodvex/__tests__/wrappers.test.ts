import { describe, expect, it } from 'bun:test'
import { v } from 'convex/values'
import { z } from 'zod'
import { zid } from '../src/ids'
import { zodTable } from '../src/tables'
import { zAction, zMutation, zQuery } from '../src/wrappers'
import { zx } from '../src/zx'

// Minimal builder stub that mimics Convex builder shape
function makeBuilder() {
  return function builder(config: { handler: (ctx: any, args: any) => any }) {
    return async (ctx: any, args: any) => config.handler(ctx, args)
  }
}

function makeCapturingBuilder() {
  let lastConfig: any
  const builder = (config: any) => {
    lastConfig = config
    return async (ctx: any, args: any) => config.handler(ctx, args)
  }
  return { builder, getLastConfig: () => lastConfig }
}

describe('wrappers arg decoding with codec-first approach', () => {
  it('decodes date args to Date instances using zx.date() codec', async () => {
    const builder = makeBuilder()
    let sawDateInstance = false

    // Use zx.date() codec instead of z.date()
    const fn = zQuery(builder as any, z.object({ when: zx.date() }), async (_ctx, args) => {
      sawDateInstance = args.when instanceof Date
      return true
    }) as unknown as (ctx: any, args: any) => Promise<any>

    const timestamp = new Date('2025-01-01T00:00:00Z').getTime()
    const res = await fn({}, { when: timestamp })
    expect(res).toBe(true)
    expect(sawDateInstance).toBe(true)
  })

  it('encodes Date return with explicit zx.date() schema', async () => {
    const builder = makeBuilder()

    // Use explicit returns schema with zx.date() for encoding
    const fn = zQuery(
      builder as any,
      { id: z.string() },
      async () => new Date('2025-02-02T00:00:00Z'),
      { returns: zx.date() }
    ) as unknown as (ctx: any, args: any) => Promise<any>

    const ret = await fn({}, { id: 'x' })
    expect(typeof ret).toBe('number')
  })

  it('mutation: decodes nested date args and encodes return with zx.date()', async () => {
    const builder = makeBuilder()

    // Use zx.date() for both args and returns
    const fn = zMutation(
      builder as any,
      z.object({
        range: z.object({ start: zx.date() })
      }),
      async (_ctx, args) => {
        // Ensure nested arg decoded to Date
        expect(args.range.start).toBeInstanceOf(Date)
        return { createdAt: new Date('2025-03-03T00:00:00Z') }
      },
      { returns: z.object({ createdAt: zx.date() }) }
    ) as unknown as (ctx: any, args: any) => Promise<any>

    const timestamp = new Date('2025-01-01T00:00:00Z').getTime()
    const ret = await fn({}, { range: { start: timestamp } })
    expect(typeof ret.createdAt).toBe('number')
  })

  it('action: returns raw values without schema', async () => {
    const builder = makeBuilder()

    // Without returns schema, values are returned as-is
    const fn = zAction(builder as any, { id: z.string() }, async () => {
      return { message: 'done', count: 42 }
    }) as unknown as (ctx: any, args: any) => Promise<any>

    const ret = await fn({}, { id: 'x' })
    expect(ret.message).toBe('done')
    expect(ret.count).toBe(42)
  })

  it('action: does not convert Date without returns schema', async () => {
    const builder = makeBuilder()
    const created = new Date('2025-02-02T00:00:00Z')

    // Without returns schema, Date should be returned as-is (no timestamp conversion)
    const fn = zAction(builder as any, { id: z.string() }, async () => {
      return { created }
    }) as unknown as (ctx: any, args: any) => Promise<any>

    const ret = await fn({}, { id: 'x' })
    expect(ret.created).toBe(created)
    expect(ret.created).toBeInstanceOf(Date)
    expect(ret.created.getTime()).toBe(created.getTime())
  })

  it('throws helpful error when z.date() is used in args (at construction time)', () => {
    const builder = makeBuilder()

    // Error should throw at construction time, not invocation time
    expect(() => {
      zQuery(builder as any, z.object({ when: z.date() }), async (_ctx, _args) => {
        return true
      })
    }).toThrow(/z\.date\(\)/)
  })

  it('throws helpful error when z.date() is used in returns (at construction time)', () => {
    const builder = makeBuilder()

    // Error should throw at construction time, not invocation time
    expect(() => {
      zQuery(builder as any, { id: z.string() }, async () => new Date('2025-02-02T00:00:00Z'), {
        returns: z.date()
      })
    }).toThrow(/z\.date\(\)/)
  })
})

describe('zodTable zDoc/docArray', () => {
  it('exposes zDoc with system fields', () => {
    const Users = zodTable('users', { name: z.string() })
    const doc = { _id: '123', _creationTime: 0, name: 'A' }
    // Runtime parse should succeed
    const parsed = Users.zDoc.parse(doc)
    expect(parsed.name).toBe('A')
  })

  it('exposes docArray helper', () => {
    const Users = zodTable('users', { name: z.string() })
    const docs = [
      { _id: '1', _creationTime: 0, name: 'A' },
      { _id: '2', _creationTime: 1, name: 'B' }
    ]
    // Runtime parse should succeed
    const parsed = Users.docArray.parse(docs)
    expect(parsed).toHaveLength(2)
    expect(parsed[0].name).toBe('A')
  })
})

describe('wrappers returns validator generation', () => {
  it('skips Convex returns validator for z.custom()', async () => {
    const { builder, getLastConfig } = makeCapturingBuilder()

    const fn = zQuery(builder as any, { id: z.string() }, async () => 'ok', {
      returns: z.custom()
    }) as unknown as (ctx: any, args: any) => Promise<any>

    expect(getLastConfig().returns).toBeUndefined()

    const ret = await fn({}, { id: 'x' })
    expect(ret).toBe('ok')
  })

  it('keeps Convex returns validator for non-custom returns', () => {
    const { builder, getLastConfig } = makeCapturingBuilder()

    zQuery(builder as any, { id: z.string() }, async () => 'ok', { returns: z.string() })

    expect(getLastConfig().returns).toEqual(v.string())
  })
})
