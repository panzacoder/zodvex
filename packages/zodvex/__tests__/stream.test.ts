/**
 * Tests for zodvexStream / zodvexMergedStream — typed convex-helpers stream
 * interop for the secure DatabaseReader (#78).
 *
 * These tests pin the duck-typed surface that convex-helpers' stream() relies
 * on — db.query(table).withIndex(...).order(...) plus async iteration — so a
 * chain-surface change in zodvex fails loudly here instead of silently
 * breaking downstream consumers.
 */

import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createZodDbReader } from '../src/internal/db'
import { defineZodModel } from '../src/internal/model'
import { defineZodSchema } from '../src/internal/schema'
import { zodvexMergedStream, zodvexStream } from '../src/internal/stream'
import { zx } from '../src/internal/zx'

// ============================================================================
// Fixture schema — visits table with a codec field and a multi-field index
// ============================================================================

const Visits = defineZodModel('visits', {
  tenantId: z.string(),
  roomId: z.string(),
  note: z.string(),
  scheduledAt: zx.date()
})
  .index('tenantId_roomId', ['tenantId', 'roomId'])
  .index('by_scheduledAt', ['scheduledAt'])

const schema = defineZodSchema({ visits: Visits })

const wireVisits = [
  {
    _id: 'visits:1',
    _creationTime: 100,
    tenantId: 't1',
    roomId: 'a',
    note: 'a1',
    scheduledAt: 1700000001000
  },
  {
    _id: 'visits:2',
    _creationTime: 200,
    tenantId: 't1',
    roomId: 'b',
    note: 'b1',
    scheduledAt: 1700000002000
  },
  {
    _id: 'visits:3',
    _creationTime: 300,
    tenantId: 't1',
    roomId: 'a',
    note: 'a2',
    scheduledAt: 1700000003000
  },
  {
    _id: 'visits:4',
    _creationTime: 400,
    tenantId: 't1',
    roomId: 'b',
    note: 'b2',
    scheduledAt: 1700000004000
  },
  {
    _id: 'visits:5',
    _creationTime: 500,
    tenantId: 't2',
    roomId: 'a',
    note: 'other',
    scheduledAt: 1700000005000
  }
]

// Index fields as Convex resolves them (user fields + _creationTime + _id)
const INDEX_FIELDS: Record<string, string[]> = {
  by_id: ['_id'],
  by_creation_time: ['_creationTime', '_id'],
  tenantId_roomId: ['tenantId', 'roomId', '_creationTime', '_id'],
  by_scheduledAt: ['scheduledAt', '_creationTime', '_id']
}

type Constraint = ['eq' | 'gt' | 'gte' | 'lt' | 'lte', string, any]

function cmp(a: any, b: any): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

/**
 * Mock raw Convex reader with real index semantics: withIndex captures
 * range constraints, order sorts by the index's fields. This is the raw
 * (wire-format) layer underneath the zodvex secure reader.
 */
function createIndexedMockDb(tables: Record<string, any[]>) {
  const makeOrdered = (docs: any[], indexFields: string[], constraints: Constraint[]) => ({
    order(order: 'asc' | 'desc') {
      const filtered = docs
        .filter(doc =>
          constraints.every(([op, field, value]) => {
            const c = cmp(doc[field], value)
            if (op === 'eq') return c === 0
            if (op === 'gt') return c > 0
            if (op === 'gte') return c >= 0
            if (op === 'lt') return c < 0
            return c <= 0
          })
        )
        .sort((d1, d2) => {
          for (const f of indexFields) {
            const c = cmp(d1[f], d2[f])
            if (c !== 0) return c
          }
          return 0
        })
      if (order === 'desc') filtered.reverse()
      return {
        collect: async () => filtered,
        [Symbol.asyncIterator]: async function* () {
          for (const doc of filtered) yield doc
        }
      }
    }
  })

  return {
    system: { get: async () => null, query: () => ({}), normalizeId: () => null },
    normalizeId: (tableName: string, id: string) => (id.startsWith(`${tableName}:`) ? id : null),
    get: async (id: string) => {
      for (const docs of Object.values(tables)) {
        const doc = docs.find((d: any) => d._id === id)
        if (doc) return doc
      }
      return null
    },
    query: (tableName: string) => {
      const docs = tables[tableName] ?? []
      return {
        withIndex(indexName: string, rangeFn?: (q: any) => any) {
          const indexFields = INDEX_FIELDS[indexName]
          if (!indexFields) throw new Error(`mock: unknown index ${indexName}`)
          const constraints: Constraint[] = []
          const builder: any = {}
          for (const op of ['eq', 'gt', 'gte', 'lt', 'lte'] as const) {
            builder[op] = (field: string, value: any) => {
              constraints.push([op, field, value])
              return builder
            }
          }
          rangeFn?.(builder)
          return makeOrdered(docs, indexFields, constraints)
        },
        fullTableScan() {
          return makeOrdered(docs, INDEX_FIELDS.by_creation_time, [])
        }
      }
    }
  }
}

function createReader() {
  const rawDb = createIndexedMockDb({ visits: wireVisits })
  return createZodDbReader(rawDb as any, schema)
}

// ============================================================================
// zodvexStream — typed stream over the secure reader
// ============================================================================

describe('zodvexStream', () => {
  it('streams decoded docs through the secure reader (pins the duck-typed surface)', async () => {
    const reader = createReader()
    const docs = await zodvexStream(reader, schema)
      .query('visits')
      .withIndex('tenantId_roomId', q => q.eq('tenantId', 't1').eq('roomId', 'a'))
      .order('asc')
      .collect()

    expect(docs.map((d: any) => d.note)).toEqual(['a1', 'a2'])
    // Streamed rows flow through the codec decode chain
    expect(docs[0].scheduledAt).toBeInstanceOf(Date)
    expect((docs[0].scheduledAt as Date).getTime()).toBe(1700000001000)
  })

  it('async-iterates decoded docs', async () => {
    const reader = createReader()
    const s = zodvexStream(reader, schema)
      .query('visits')
      .withIndex('tenantId_roomId', q => q.eq('tenantId', 't1').eq('roomId', 'b'))
      .order('asc')

    const notes: string[] = []
    for await (const doc of s) {
      notes.push(doc.note)
      expect(doc.scheduledAt).toBeInstanceOf(Date)
    }
    expect(notes).toEqual(['b1', 'b2'])
  })

  it('first()/take() return decoded docs', async () => {
    const reader = createReader()
    const s = zodvexStream(reader, schema)
      .query('visits')
      .withIndex('tenantId_roomId', q => q.eq('tenantId', 't1'))
      .order('desc')

    const first = await s.first()
    expect(first?.note).toBe('b2')
    expect(first?.scheduledAt).toBeInstanceOf(Date)
  })

  it('paginate() on a single stream returns decoded pages with working cursors', async () => {
    const reader = createReader()
    const makeStream = () =>
      zodvexStream(reader, schema)
        .query('visits')
        .withIndex('tenantId_roomId', q => q.eq('tenantId', 't1'))
        .order('asc')

    // Index order with only tenantId pinned: by roomId, then _creationTime
    const page1 = await makeStream().paginate({ numItems: 3, cursor: null })
    expect(page1.page.map((d: any) => d.note)).toEqual(['a1', 'a2', 'b1'])
    expect(page1.page[0].scheduledAt).toBeInstanceOf(Date)
    expect(page1.isDone).toBe(false)

    const page2 = await makeStream().paginate({ numItems: 10, cursor: page1.continueCursor })
    expect(page2.page.map((d: any) => d.note)).toEqual(['b2'])
    expect(page2.isDone).toBe(true)
  })

  it('preserves read rules: denied rows are skipped mid-stream without holes', async () => {
    const reader = createReader().withRules(
      {},
      {
        visits: {
          read: async (_ctx: any, doc: any) => (doc.roomId === 'a' ? doc : null)
        }
      }
    )

    const docs = await zodvexStream(reader, schema)
      .query('visits')
      .withIndex('tenantId_roomId', q => q.eq('tenantId', 't1'))
      .order('asc')
      .collect()

    expect(docs.map((d: any) => d.note)).toEqual(['a1', 'a2'])
  })
})

// ============================================================================
// zodvexMergedStream — k-way merge over substreams
// ============================================================================

describe('zodvexMergedStream', () => {
  it('merges fan-out substreams and paginates with index-key cursors', async () => {
    const reader = createReader()
    const makeSubstreams = () =>
      ['a', 'b'].map(roomId =>
        zodvexStream(reader, schema)
          .query('visits')
          .withIndex('tenantId_roomId', q => q.eq('tenantId', 't1').eq('roomId', roomId))
          .order('asc')
      )

    const page1 = await zodvexMergedStream(makeSubstreams(), ['_creationTime']).paginate({
      numItems: 2,
      cursor: null
    })
    expect(page1.page.map((d: any) => d.note)).toEqual(['a1', 'b1'])
    expect(page1.page[0].scheduledAt).toBeInstanceOf(Date)
    expect(page1.isDone).toBe(false)

    const page2 = await zodvexMergedStream(makeSubstreams(), ['_creationTime']).paginate({
      numItems: 10,
      cursor: page1.continueCursor
    })
    expect(page2.page.map((d: any) => d.note)).toEqual(['a2', 'b2'])
    expect(page2.isDone).toBe(true)
  })

  it('merge respects rules: denied rows never enter the merged cursor space', async () => {
    const reader = createReader().withRules(
      {},
      {
        visits: {
          read: async (_ctx: any, doc: any) => (doc.note === 'b1' ? null : doc)
        }
      }
    )
    const substreams = ['a', 'b'].map(roomId =>
      zodvexStream(reader, schema)
        .query('visits')
        .withIndex('tenantId_roomId', q => q.eq('tenantId', 't1').eq('roomId', roomId))
        .order('asc')
    )

    const docs = await zodvexMergedStream(substreams, ['_creationTime']).collect()
    expect(docs.map((d: any) => d.note)).toEqual(['a1', 'a2', 'b2'])
  })

  it('forbids codec-backed fields in orderByIndexFields', () => {
    const reader = createReader()
    const substreams = ['a', 'b'].map(() =>
      zodvexStream(reader, schema).query('visits').withIndex('by_scheduledAt').order('asc')
    )

    expect(() => zodvexMergedStream(substreams, ['scheduledAt'])).toThrow(/codec-backed/i)
  })

  it('allows non-codec orderByIndexFields on tables that have codec fields elsewhere', () => {
    const reader = createReader()
    const substreams = ['a', 'b'].map(roomId =>
      zodvexStream(reader, schema)
        .query('visits')
        .withIndex('tenantId_roomId', q => q.eq('tenantId', 't1').eq('roomId', roomId))
        .order('asc')
    )

    expect(() => zodvexMergedStream(substreams, ['_creationTime'])).not.toThrow()
  })
})

// ============================================================================
// Type-level assertions — stream items are DECODED doc types
// ============================================================================

type AssertAssignable<A, B> = A extends B ? true : false

async function _typeOnly() {
  const reader = createReader()
  const s = zodvexStream(reader, schema)
    .query('visits')
    .withIndex('tenantId_roomId', q => q.eq('tenantId', 't1'))
    .order('asc')

  const docs = await s.collect()
  // scheduledAt is the decoded (runtime) type — Date, not the wire number
  type _scheduledAtIsDate = AssertAssignable<(typeof docs)[number]['scheduledAt'], Date>
  const _check1: _scheduledAtIsDate = true

  const merged = zodvexMergedStream([s], ['_creationTime'])
  const page = await merged.paginate({ numItems: 1, cursor: null })
  type _pageIsDecoded = AssertAssignable<(typeof page.page)[number]['scheduledAt'], Date>
  const _check2: _pageIsDecoded = true

  return [_check1, _check2]
}
void _typeOnly
