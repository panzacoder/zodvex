import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { createZodDbReader } from '../../src/db/wrapper'
import { zodTable } from '../../src/tables'
import { zx } from '../../src/zx'

// A custom codec to exercise the codec path
const stateCode = zx.codec(z.string(), z.string(), {
  decode: (wire: string) => wire.toUpperCase(),
  encode: (runtime: string) => runtime.toLowerCase()
})

const Events = zodTable('events', {
  title: z.string(),
  startDate: zx.date(),
  endDate: zx.date().optional(),
  state: stateCode,
  description: z.string().optional()
})

const zodTables = { events: Events }

function generateWireDocs(count: number) {
  const docs = []
  const baseTime = 1700000000000
  for (let i = 0; i < count; i++) {
    docs.push({
      _id: `events:${i}`,
      _creationTime: baseTime + i,
      _table: 'events',
      title: `Event ${i}`,
      startDate: baseTime + i * 3600000,
      endDate: i % 3 === 0 ? baseTime + i * 3600000 + 1800000 : undefined,
      state: 'ca',
      description: i % 2 === 0 ? `Description for event ${i}` : undefined
    })
  }
  return docs
}

describe('decode benchmark', () => {
  it('decodes 1000 docs with mixed codecs in <25ms', async () => {
    const docs = generateWireDocs(1000)

    const mockDb = {
      get: async (_id: string) => null,
      query: (_table: string) => ({
        withIndex: () => mockDb.query(_table),
        filter: () => mockDb.query(_table),
        order: () => mockDb.query(_table),
        collect: async () => docs,
        first: async () => docs[0] ?? null,
        unique: async () => null,
        take: async (n: number) => docs.slice(0, n)
      })
    }

    const zodDb = createZodDbReader(mockDb as any, zodTables)

    // Warm up JIT
    await zodDb.query('events').take(10)

    const start = performance.now()
    const decoded = await zodDb.query('events').collect()
    const elapsed = performance.now() - start

    expect(decoded).toHaveLength(1000)
    // Spot-check codec transforms
    expect(decoded[0].startDate).toBeInstanceOf(Date)
    expect(decoded[0].state).toBe('CA')
    // Verify optional fields
    expect(decoded[0].endDate).toBeInstanceOf(Date)
    expect(decoded[1].endDate).toBeUndefined()

    console.log(`Decoded 1000 docs in ${elapsed.toFixed(2)}ms`)
    expect(elapsed).toBeLessThan(25)
  })
})
