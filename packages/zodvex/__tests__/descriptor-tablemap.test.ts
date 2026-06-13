import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ZodvexDatabaseReader, ZodvexDatabaseWriter } from '../src/internal/db'
import { zx } from '../src/internal/zx'
import { createMockDbReader, createMockDbWriter } from './fixtures/mock-db'

// ---------------------------------------------------------------------------
// Descriptor tableMap entries — the codec-paths design's runtime contract.
// A generated _zodvex/models/<table>.js exports a MINIMAL loose schema
// (codec fields only); the db wrapper must treat it as an ordinary
// ZodTableSchemas entry: decode/encode codec fields, pass every other
// field through untouched.
// ---------------------------------------------------------------------------

const TS = 1700000000000

// Mirrors generated output for a table { name, createdAt: zx.date(),
// meta.history: zx.date()[] (nested array path), updatedAt?: zx.date() }
const descriptorSchema = z.looseObject({
  createdAt: zx.date(),
  updatedAt: z.optional(zx.date()),
  meta: z.looseObject({
    history: z.array(zx.date())
  })
})
const descriptorEntry = { doc: descriptorSchema, insert: descriptorSchema }

const wireDoc = {
  _id: 'events:1',
  _creationTime: 100,
  name: 'launch', // NOT in the descriptor — must pass through untouched
  createdAt: TS,
  meta: { history: [TS, TS + 1], note: 'keep-me' }
}

function reader(docs: Record<string, any[]>) {
  return new ZodvexDatabaseReader(
    createMockDbReader(docs) as any,
    {
      events: descriptorEntry
    } as any
  )
}

describe('descriptor (codec-paths) tableMap entries', () => {
  it('get(): decodes codec paths, passes unknown fields through', async () => {
    const db = reader({ events: [wireDoc] })
    const doc: any = await db.get('events:1' as any)

    expect(doc.createdAt).toBeInstanceOf(Date)
    expect(doc.createdAt.getTime()).toBe(TS)
    expect(doc.meta.history[0]).toBeInstanceOf(Date)
    expect(doc.meta.history[1].getTime()).toBe(TS + 1)
    // Loose passthrough — fields the descriptor never mentions survive.
    expect(doc.name).toBe('launch')
    expect(doc.meta.note).toBe('keep-me')
    expect(doc._id).toBe('events:1')
  })

  it('get(): optional codec field absent stays absent', async () => {
    const db = reader({ events: [wireDoc] })
    const doc: any = await db.get('events:1' as any)
    expect('updatedAt' in doc).toBe(false)
  })

  it('query().collect(): decodes through the chain', async () => {
    const db = reader({ events: [wireDoc] })
    const docs: any[] = await (db.query('events' as any) as any).collect()
    expect(docs[0].createdAt).toBeInstanceOf(Date)
    expect(docs[0].name).toBe('launch')
  })

  it('insert(): encodes codec paths, passes unknown fields through', async () => {
    const { db: rawDb, calls } = createMockDbWriter({ events: [] })
    const db = new ZodvexDatabaseWriter(rawDb as any, { events: descriptorEntry } as any)

    await db.insert(
      'events' as any,
      {
        name: 'launch',
        createdAt: new Date(TS),
        meta: { history: [new Date(TS)], note: 'keep-me' }
      } as any
    )

    const written = calls[0].args[1]
    expect(written.createdAt).toBe(TS) // encoded
    expect(written.meta.history[0]).toBe(TS)
    expect(written.name).toBe('launch') // passthrough
    expect(written.meta.note).toBe('keep-me')
  })

  it('patch(): partial encode touches only present codec fields', async () => {
    const { db: rawDb, calls } = createMockDbWriter({ events: [wireDoc] })
    const db = new ZodvexDatabaseWriter(rawDb as any, { events: descriptorEntry } as any)

    await db.patch('events:1' as any, { updatedAt: new Date(TS + 5), name: 'renamed' } as any)

    const patched = calls[0].args[calls[0].args.length - 1]
    expect(patched.updatedAt).toBe(TS + 5)
    expect(patched.name).toBe('renamed')
    expect('createdAt' in patched).toBe(false)
  })

  it('tables absent from the map pass through entirely (codec-free tables)', async () => {
    const db = reader({ plain: [{ _id: 'plain:1', _creationTime: 1, at: TS }] })
    const doc: any = await db.get('plain:1' as any)
    expect(doc.at).toBe(TS) // no descriptor -> wire values, by design
  })
})
