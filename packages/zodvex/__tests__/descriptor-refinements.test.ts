/**
 * Write-side refinement enforcement for codec-paths descriptors (PR #80).
 *
 * The codec-paths rework made each descriptor's `insert` a codec-ONLY minimal
 * loose schema, so non-codec refinements (.email(), .min(), regex, …) on data
 * CONSTRUCTED IN A HANDLER were no longer enforced on db.insert/patch/replace —
 * silently. These tests pin the fix:
 *   - `insert` carries serializable built-in checks (write-path enforcement)
 *   - `doc` stays codec-only minimal (permissive reads)
 *   - custom .refine()/.transform() force an insert-only full-model fallback
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ZodvexDatabaseWriter } from '../src/internal/db'
import { encode } from '../src/internal/zod-core'
import { zx } from '../src/internal/zx'
import type { DiscoveredModel } from '../src/public/codegen/discover'
import { generateModelDescriptors } from '../src/public/codegen/generate'
import { createMockDbWriter } from './fixtures/mock-db'

/**
 * Evaluates a generated descriptor's `.js` source into its default export
 * ({ doc, insert }), injecting the `z`/`zx` the import lines reference.
 * Only valid for descriptors whose sole imports are zod + zodvex (no custom
 * codec module imports) — sufficient for the refinement fixtures here.
 */
function loadDescriptor(js: string): { doc: any; insert: any } {
  const body = js
    .split('\n')
    .filter(line => !line.trimStart().startsWith('import '))
    .join('\n')
    .replace(/export default/, 'return')
  // eslint-disable-next-line no-new-func
  return new Function('z', 'zx', body)(z, zx)
}

const TS = 1700000000000

describe('descriptor insert-side refinement enforcement', () => {
  it('emits serializable checks into `insert`, keeps `doc` codec-only', () => {
    const model: DiscoveredModel = {
      exportName: 'UserModel',
      tableName: 'users',
      sourceFile: 'models/user.ts',
      schemas: {
        doc: z.object({
          _id: z.string(),
          email: z.string().email(),
          age: z.number().min(18),
          createdAt: zx.date()
        }),
        insert: z.object({
          email: z.string().email(),
          age: z.number().min(18),
          createdAt: zx.date()
        })
      } as any
    }

    const out = generateModelDescriptors([model])
    expect(out.fallbacks).toHaveLength(0)
    const { doc, insert } = loadDescriptor(out.files[0].js)

    // insert ENFORCES the refinements on handler-constructed values
    expect(() => encode(insert, { email: 'nope', age: 25, createdAt: new Date(TS) })).toThrow()
    expect(() => encode(insert, { email: 'a@b.com', age: 5, createdAt: new Date(TS) })).toThrow()
    // valid value passes, codec field still encodes, unknown fields pass through
    const okWire = encode(insert, {
      email: 'a@b.com',
      age: 25,
      createdAt: new Date(TS),
      extra: 'keep'
    }) as any
    expect(okWire.createdAt).toBe(TS)
    expect(okWire.extra).toBe('keep')

    // doc stays PERMISSIVE: a row violating the (since-tightened) refinement
    // must still decode — no read-side re-validation.
    expect(() => encode(doc, { email: 'nope', age: 5, createdAt: new Date(TS) })).not.toThrow()
  })

  it('custom .refine() forces insert-only full-model fallback; doc stays minimal', () => {
    const model: DiscoveredModel = {
      exportName: 'OrderModel',
      tableName: 'orders',
      sourceFile: 'models/order.ts',
      schemas: {
        doc: z.object({ _id: z.string(), createdAt: zx.date() }),
        insert: z
          .object({ low: z.number(), high: z.number(), createdAt: zx.date() })
          .refine(o => o.low < o.high, 'low<high')
      } as any
    }

    const out = generateModelDescriptors([model])
    // insert-only fallback — NOT a whole-table fallback
    expect(out.fallbacks.some(f => f.tableName === 'orders')).toBe(false)
    expect(out.insertFallbacks.some(f => f.tableName === 'orders')).toBe(true)
    const js = out.files[0].js
    // insert imports the full model; doc keeps the minimal codec-only schema
    expect(js).toContain('insert: OrderModel.schema.insert')
    expect(js).toContain('const docSchema = z.looseObject({ createdAt: zx.date(), })')
    // doc is NOT a full-model import
    expect(js).not.toContain('doc: OrderModel')
  })

  it('.transform() forces insert-only fallback with a reason mentioning transform', () => {
    const model: DiscoveredModel = {
      exportName: 'BlobModel',
      tableName: 'blobs',
      sourceFile: 'models/blob.ts',
      schemas: {
        doc: z.object({ _id: z.string(), createdAt: zx.date() }),
        insert: z.object({ slug: z.string().transform(s => s.toLowerCase()), createdAt: zx.date() })
      } as any
    }
    const out = generateModelDescriptors([model])
    const fb = out.insertFallbacks.find(f => f.tableName === 'blobs')
    expect(fb).toBeDefined()
    expect(fb!.reason).toContain('transform')
    expect(out.files[0].js).toContain('insert: BlobModel.schema.insert')
  })

  it('checks inside z.intersection are enforced via insert fallback (not silently dropped)', () => {
    // Intersections map to v.any() in the Convex validator, so if the
    // descriptor walker misses the check here NOTHING enforces it.
    const model: DiscoveredModel = {
      exportName: 'MergeModel',
      tableName: 'merges',
      sourceFile: 'models/merge.ts',
      schemas: {
        doc: z.object({ _id: z.string(), createdAt: zx.date() }),
        insert: z.object({
          createdAt: zx.date(),
          combo: z.intersection(z.object({ a: z.string().min(3) }), z.object({ b: z.string() }))
        })
      } as any
    }
    const out = generateModelDescriptors([model])
    expect(out.insertFallbacks.some(f => f.tableName === 'merges')).toBe(true)
  })

  it('checks inside an object catchall are enforced via insert fallback', () => {
    const model: DiscoveredModel = {
      exportName: 'BagModel',
      tableName: 'bags',
      sourceFile: 'models/bag.ts',
      schemas: {
        doc: z.object({ _id: z.string(), createdAt: zx.date() }),
        insert: z.object({ createdAt: zx.date() }).catchall(z.string().min(3))
      } as any
    }
    const out = generateModelDescriptors([model])
    expect(out.insertFallbacks.some(f => f.tableName === 'bags')).toBe(true)
  })

  it('checks inside a z.lazy subtree are enforced via insert fallback', () => {
    const node: any = z.object({ label: z.string().min(3) })
    const model: DiscoveredModel = {
      exportName: 'LazyCheckModel',
      tableName: 'lazychecks',
      sourceFile: 'models/lazycheck.ts',
      schemas: {
        doc: z.object({ _id: z.string(), createdAt: zx.date() }),
        insert: z.object({ createdAt: zx.date(), child: z.lazy(() => node) })
      } as any
    }
    const out = generateModelDescriptors([model])
    expect(out.insertFallbacks.some(f => f.tableName === 'lazychecks')).toBe(true)
  })

  it('zx.id() fields do NOT force a fallback — insert stays minimal (codec-only)', () => {
    // zid carries a `custom` id-shape check, but it is a passthrough field on
    // reads, so it must not pull the whole table into a full-model insert.
    const model: DiscoveredModel = {
      exportName: 'PostModel',
      tableName: 'posts',
      sourceFile: 'models/post.ts',
      schemas: {
        doc: z.object({ _id: z.string(), authorId: zx.id('users'), createdAt: zx.date() }),
        insert: z.object({ authorId: zx.id('users'), createdAt: zx.date() })
      } as any
    }
    const out = generateModelDescriptors([model])
    expect(out.fallbacks).toHaveLength(0)
    expect(out.insertFallbacks).toHaveLength(0)
    const js = out.files[0].js
    // byte-identical shared-const form: insert === doc, no model import, no zid
    expect(js).toContain('export default { doc: schema, insert: schema }')
    expect(js).not.toContain('PostModel')
    expect(js).not.toContain('zx.id(')
  })

  it('zid alongside a real refinement: zid dropped, the refinement still enforced', () => {
    const model: DiscoveredModel = {
      exportName: 'MsgModel',
      tableName: 'msgs',
      sourceFile: 'models/msg.ts',
      schemas: {
        doc: z.object({ _id: z.string(), createdAt: zx.date() }),
        insert: z.object({
          authorId: zx.id('users'),
          email: z.string().email(),
          createdAt: zx.date()
        })
      } as any
    }
    const out = generateModelDescriptors([model])
    expect(out.insertFallbacks).toHaveLength(0)
    const { insert } = loadDescriptor(out.files[0].js)
    // email enforced; zid passes through untouched
    expect(() =>
      encode(insert, { authorId: 'x', email: 'nope', createdAt: new Date(TS) })
    ).toThrow()
    const ok = encode(insert, {
      authorId: 'anything',
      email: 'a@b.com',
      createdAt: new Date(TS)
    }) as any
    expect(ok.authorId).toBe('anything') // passthrough, not validated
    expect(ok.createdAt).toBe(TS)
  })

  it('codec-FREE table with a refinement still gets an insert-enforcing descriptor', () => {
    // Pre-fix these tables were skipped entirely → no write-side enforcement.
    const model: DiscoveredModel = {
      exportName: 'TagModel',
      tableName: 'tags',
      sourceFile: 'models/tag.ts',
      schemas: {
        doc: z.object({ _id: z.string(), label: z.string().min(2) }),
        insert: z.object({ label: z.string().min(2) })
      } as any
    }
    const out = generateModelDescriptors([model])
    expect(out.files).toHaveLength(1)
    const { doc, insert } = loadDescriptor(out.files[0].js)
    // insert enforces; doc is permissive passthrough
    expect(() => encode(insert, { label: 'x' })).toThrow()
    expect(encode(insert, { label: 'ok', extra: 1 }) as any).toMatchObject({
      label: 'ok',
      extra: 1
    })
    expect(() => encode(doc, { label: 'x' })).not.toThrow()
  })

  it('serializes the common built-in checks faithfully', () => {
    const model: DiscoveredModel = {
      exportName: 'WidgetModel',
      tableName: 'widgets',
      sourceFile: 'models/widget.ts',
      schemas: {
        doc: z.object({ _id: z.string() }),
        insert: z.object({
          name: z.string().min(2).max(5),
          code: z.string().regex(/^[A-Z]+$/),
          id: z.string().uuid(),
          qty: z.number().int().gte(1).lt(100),
          factor: z.number().multipleOf(0.5)
        })
      } as any
    }
    const out = generateModelDescriptors([model])
    const { insert } = loadDescriptor(out.files[0].js)
    expect(() =>
      encode(insert, { name: 'a', code: 'AB', id: crypto.randomUUID(), qty: 5, factor: 1 })
    ).toThrow() // name too short
    expect(() =>
      encode(insert, { name: 'abc', code: 'ab', id: crypto.randomUUID(), qty: 5, factor: 1 })
    ).toThrow() // code lowercase
    expect(() =>
      encode(insert, { name: 'abc', code: 'AB', id: 'not-a-uuid', qty: 5, factor: 1 })
    ).toThrow() // bad uuid
    expect(() =>
      encode(insert, { name: 'abc', code: 'AB', id: crypto.randomUUID(), qty: 0, factor: 1 })
    ).toThrow() // qty < 1
    expect(() =>
      encode(insert, { name: 'abc', code: 'AB', id: crypto.randomUUID(), qty: 5, factor: 0.3 })
    ).toThrow() // not multiple of .5
    expect(() =>
      encode(insert, { name: 'abc', code: 'AB', id: crypto.randomUUID(), qty: 5, factor: 1.5 })
    ).not.toThrow()
  })

  it('produces byte-identical, deterministic output regardless of model order', () => {
    const a: DiscoveredModel = {
      exportName: 'AModel',
      tableName: 'a',
      sourceFile: 'models/a.ts',
      schemas: {
        doc: z.object({ _id: z.string(), createdAt: zx.date() }),
        insert: z.object({ email: z.string().email(), createdAt: zx.date() })
      } as any
    }
    const b: DiscoveredModel = {
      exportName: 'BModel',
      tableName: 'b',
      sourceFile: 'models/b.ts',
      schemas: {
        doc: z.object({ _id: z.string(), n: z.number().min(0) }),
        insert: z.object({ n: z.number().min(0) })
      } as any
    }
    const out1 = generateModelDescriptors([a, b])
    const out2 = generateModelDescriptors([b, a])
    expect(out1.indexJs).toBe(out2.indexJs)
    expect(out1.files.map(f => f.js)).toEqual(out2.files.map(f => f.js))
  })

  it('mini mode emits .check(z.*) factory form, not method chaining', () => {
    const model: DiscoveredModel = {
      exportName: 'MiniModel',
      tableName: 'minis',
      sourceFile: 'models/mini.ts',
      schemas: {
        doc: z.object({ _id: z.string() }),
        insert: z.object({ email: z.string().email() })
      } as any
    }
    const out = generateModelDescriptors([model], undefined, { mini: true })
    const js = out.files[0].js
    expect(js).toContain('.check(z.email())')
    // chaining form `z.string().email()` is invalid in zod/mini — must not appear
    expect(js).not.toContain('z.string().email(')
    expect(js).toContain("from 'zod/mini'")
  })
})

// ---------------------------------------------------------------------------
// Runtime write-path enforcement through the db wrapper (the headline
// regression: handler-constructed values must be validated on write).
// ---------------------------------------------------------------------------

describe('write-path refinement enforcement through ZodvexDatabaseWriter', () => {
  // Mirrors a generated descriptor: doc permissive, insert enforcing.
  const docSchema = z.looseObject({ createdAt: zx.date() })
  const insertSchema = z.looseObject({
    email: z.string().check(z.email()),
    createdAt: zx.date()
  })
  const entry = { doc: docSchema, insert: insertSchema }

  function writer(seed: Record<string, any[]> = { users: [] }) {
    const { db: rawDb, calls } = createMockDbWriter(seed)
    return { db: new ZodvexDatabaseWriter(rawDb as any, { users: entry } as any), calls }
  }

  it('insert() rejects a refinement-violating value, accepts a valid one', async () => {
    const { db, calls } = writer()
    await expect(
      db.insert('users' as any, { email: 'nope', createdAt: new Date(TS) } as any)
    ).rejects.toThrow()
    await db.insert('users' as any, { email: 'a@b.com', createdAt: new Date(TS) } as any)
    expect(calls.at(-1)!.args[1].createdAt).toBe(TS) // codec still encoded
  })

  it('replace() enforces refinements', async () => {
    const { db } = writer({ users: [{ _id: 'users:1', _creationTime: 1, email: 'a@b.com' }] })
    await expect(
      db.replace('users:1' as any, { email: 'bad', createdAt: new Date(TS) } as any)
    ).rejects.toThrow()
  })

  it('patch() enforces refinements on PRESENT fields, ignores absent ones', async () => {
    const { db, calls } = writer({
      users: [{ _id: 'users:1', _creationTime: 1, email: 'a@b.com' }]
    })
    await expect(db.patch('users:1' as any, { email: 'bad' } as any)).rejects.toThrow()
    // absent refined field → no enforcement, codec field still encodes
    await db.patch('users:1' as any, { createdAt: new Date(TS + 1) } as any)
    expect(calls.at(-1)!.args.at(-1).createdAt).toBe(TS + 1)
  })
})
