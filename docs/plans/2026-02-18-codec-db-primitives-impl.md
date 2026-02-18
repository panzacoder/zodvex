# Codec DB Primitives Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement DB-level codec wrapping (boundaries 5 and 6) — automatic decode on reads, encode on writes.

**Architecture:** Three layers bottom-up: (1) primitive functions `decodeDoc`/`encodeDoc`/`encodePartialDoc`, (2) `defineZodSchema` for table map capture, (3) wrapper classes `CodecDatabaseReader`/`Writer` + `CodecQueryChain` + factory functions.

**Tech Stack:** Zod v4 (`z.encode`, `schema.parse`, `schema.partial()`), Convex server types (`GenericDatabaseReader`, `GenericDatabaseWriter`, `QueryInitializer`, `Query`, `OrderedQuery`), bun test runner.

**Design doc:** `docs/plans/2026-02-18-codec-db-primitives-design.md`

**Reference files:**
- Convex DB interfaces: `node_modules/convex/src/server/database.ts`
- Convex query chain: `node_modules/convex/src/server/query.ts`
- convex-helpers WrapReader/Writer pattern: `node_modules/convex-helpers/server/rowLevelSecurity.ts:185-362`
- Existing codec: `src/codec.ts`
- Existing tables: `src/tables.ts`
- Existing utils: `src/utils.ts` (stripUndefined)
- Core exports: `src/core/index.ts`
- Server exports: `src/server/index.ts`
- Export tests: `__tests__/exports.test.ts`

---

### Task 1: `decodeDoc` and `encodeDoc` Primitives

**Files:**
- Modify: `src/codec.ts`
- Test: `__tests__/codec-doc.test.ts`

**Step 1: Write the failing tests**

```typescript
// __tests__/codec-doc.test.ts
import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { decodeDoc, encodeDoc } from '../src/codec'
import { zx } from '../src/zx'

describe('decodeDoc', () => {
  it('decodes a wire document to runtime types', () => {
    const schema = z.object({
      name: z.string(),
      createdAt: zx.date(),
    })

    const wireDoc = { name: 'Alice', createdAt: 1700000000000 }
    const result = decodeDoc(schema, wireDoc)

    expect(result.name).toBe('Alice')
    expect(result.createdAt).toBeInstanceOf(Date)
    expect(result.createdAt.getTime()).toBe(1700000000000)
  })

  it('passes through plain fields without codecs', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    })

    const wireDoc = { name: 'Bob', age: 30 }
    const result = decodeDoc(schema, wireDoc)

    expect(result).toEqual({ name: 'Bob', age: 30 })
  })

  it('handles nullable codec fields', () => {
    const schema = z.object({
      deletedAt: zx.date().nullable(),
    })

    expect(decodeDoc(schema, { deletedAt: null }).deletedAt).toBe(null)
    expect(decodeDoc(schema, { deletedAt: 1700000000000 }).deletedAt).toBeInstanceOf(Date)
  })

  it('handles optional codec fields', () => {
    const schema = z.object({
      name: z.string(),
      updatedAt: zx.date().optional(),
    })

    expect(decodeDoc(schema, { name: 'Alice' })).toEqual({ name: 'Alice' })

    const withDate = decodeDoc(schema, { name: 'Alice', updatedAt: 1700000000000 })
    expect(withDate.updatedAt).toBeInstanceOf(Date)
  })
})

describe('encodeDoc', () => {
  it('encodes a runtime document to wire format', () => {
    const schema = z.object({
      name: z.string(),
      createdAt: zx.date(),
    })

    const runtimeDoc = { name: 'Alice', createdAt: new Date(1700000000000) }
    const result = encodeDoc(schema, runtimeDoc)

    expect(result).toEqual({ name: 'Alice', createdAt: 1700000000000 })
  })

  it('strips explicit undefined values', () => {
    const schema = z.object({
      name: z.string(),
      nickname: z.string().optional(),
    })

    const result = encodeDoc(schema, { name: 'Alice', nickname: undefined })

    expect(result).toEqual({ name: 'Alice' })
    expect('nickname' in result).toBe(false)
  })

  it('handles nullable codec fields', () => {
    const schema = z.object({
      deletedAt: zx.date().nullable(),
    })

    expect(encodeDoc(schema, { deletedAt: null })).toEqual({ deletedAt: null })
    expect(encodeDoc(schema, { deletedAt: new Date(1700000000000) })).toEqual({
      deletedAt: 1700000000000,
    })
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `bun test __tests__/codec-doc.test.ts`
Expected: FAIL — `decodeDoc` and `encodeDoc` are not exported from `src/codec.ts`

**Step 3: Write minimal implementation**

Add to `src/codec.ts`:

```typescript
/**
 * Decodes a wire-format document (from Convex DB) to runtime types.
 * Runs Zod codec decode transforms (e.g., timestamp → Date via zx.date()).
 */
export function decodeDoc<S extends z.ZodTypeAny>(schema: S, wireDoc: unknown): z.output<S> {
  return schema.parse(wireDoc)
}

/**
 * Encodes a runtime document to wire format (for Convex DB writes).
 * Runs Zod codec encode transforms and strips undefined values.
 */
export function encodeDoc<S extends z.ZodTypeAny>(schema: S, runtimeDoc: z.output<S>): z.input<S> {
  return stripUndefined(z.encode(schema, runtimeDoc))
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test __tests__/codec-doc.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/codec.ts __tests__/codec-doc.test.ts
git commit -m "feat: add decodeDoc and encodeDoc primitives"
```

---

### Task 2: `encodePartialDoc` Primitive

**Files:**
- Modify: `src/codec.ts`
- Modify: `__tests__/codec-doc.test.ts`

**Step 1: Write the failing tests**

Add to `__tests__/codec-doc.test.ts`:

```typescript
describe('encodePartialDoc', () => {
  it('encodes only the fields present in the partial', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
      createdAt: zx.date(),
    })

    // Only updating createdAt — name and age are absent
    const result = encodePartialDoc(schema, { createdAt: new Date(1700000000000) })

    expect(result).toEqual({ createdAt: 1700000000000 })
    expect('name' in result).toBe(false)
    expect('age' in result).toBe(false)
  })

  it('handles mix of plain and codec fields', () => {
    const schema = z.object({
      name: z.string(),
      updatedAt: zx.date(),
    })

    const result = encodePartialDoc(schema, {
      name: 'Updated Name',
      updatedAt: new Date(1700000000000),
    })

    expect(result).toEqual({ name: 'Updated Name', updatedAt: 1700000000000 })
  })

  it('strips undefined values from partial', () => {
    const schema = z.object({
      name: z.string(),
      nickname: z.string().optional(),
    })

    const result = encodePartialDoc(schema, { name: 'Alice', nickname: undefined })

    expect(result).toEqual({ name: 'Alice' })
    expect('nickname' in result).toBe(false)
  })

  it('handles empty partial', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    })

    const result = encodePartialDoc(schema, {})

    expect(result).toEqual({})
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `bun test __tests__/codec-doc.test.ts`
Expected: FAIL — `encodePartialDoc` is not exported

**Step 3: Write minimal implementation**

Add to `src/codec.ts`:

```typescript
/**
 * Encodes a partial runtime document to wire format (for Convex DB patch operations).
 * Only encodes the fields present in the partial. Uses schema.partial() + z.encode().
 */
export function encodePartialDoc<S extends z.ZodTypeAny>(
  schema: S,
  partial: Partial<z.output<S>>
): Partial<z.input<S>> {
  if (!(schema instanceof z.ZodObject)) {
    // For non-object schemas (unions, etc.), fall back to full encode
    return stripUndefined(z.encode(schema, partial))
  }
  const partialSchema = schema.partial()
  return stripUndefined(z.encode(partialSchema, partial))
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test __tests__/codec-doc.test.ts`
Expected: PASS

If `schema.partial()` + `z.encode()` doesn't handle absent fields correctly (e.g., injects defaults or errors on missing required fields), implement fallback: iterate `Object.keys(partial)`, look up each field's schema from `schema.shape`, encode field-by-field.

**Step 5: Commit**

```bash
git add src/codec.ts __tests__/codec-doc.test.ts
git commit -m "feat: add encodePartialDoc primitive"
```

---

### Task 3: `defineZodSchema` and `ZodTableMap`

**Files:**
- Create: `src/schema.ts`
- Test: `__tests__/schema.test.ts`

**Step 1: Write the failing tests**

```typescript
// __tests__/schema.test.ts
import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { defineZodSchema } from '../src/schema'
import { zodTable } from '../src/tables'
import { zx } from '../src/zx'

const Users = zodTable('users', {
  name: z.string(),
  createdAt: zx.date(),
})

const Posts = zodTable('posts', {
  title: z.string(),
  authorId: zx.id('users'),
})

describe('defineZodSchema', () => {
  it('returns an object with __zodTableMap', () => {
    const schema = defineZodSchema({ users: Users, posts: Posts })

    expect(schema.__zodTableMap).toBeDefined()
    expect(schema.__zodTableMap.users).toBeDefined()
    expect(schema.__zodTableMap.posts).toBeDefined()
  })

  it('captures doc schemas (with system fields) in the table map', () => {
    const schema = defineZodSchema({ users: Users })

    const userDocSchema = schema.__zodTableMap.users
    // Should be the doc schema — includes _id and _creationTime
    const parsed = userDocSchema.parse({
      _id: 'users:abc123',
      _creationTime: 1700000000000,
      name: 'Alice',
      createdAt: 1700000000000,
    })

    expect(parsed.name).toBe('Alice')
    expect(parsed.createdAt).toBeInstanceOf(Date)
  })

  it('returns a valid Convex schema (has tables property)', () => {
    const schema = defineZodSchema({ users: Users, posts: Posts })

    // Convex schema objects have a `tables` property
    expect(schema).toHaveProperty('tables')
  })

  it('works with empty table set', () => {
    const schema = defineZodSchema({})

    expect(schema.__zodTableMap).toEqual({})
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `bun test __tests__/schema.test.ts`
Expected: FAIL — `defineZodSchema` doesn't exist

**Step 3: Write minimal implementation**

```typescript
// src/schema.ts
import { defineSchema } from 'convex/server'
import type { z } from 'zod'

/**
 * Maps table names to their Zod doc schemas (with system fields).
 * Used by CodecDatabaseReader/Writer to look up decode/encode schemas.
 */
export type ZodTableMap = Record<string, z.ZodTypeAny>

// Accept any zodTable() result shape — both object-shape and union overloads
type ZodTableEntry = {
  table: any
  schema: { doc: z.ZodTypeAny }
}

/**
 * Wraps Convex's defineSchema() and captures zodTable references.
 * The returned object is a valid Convex schema AND carries __zodTableMap
 * for use by createZodDbReader/createZodDbWriter.
 *
 * @example
 * ```typescript
 * // convex/schema.ts
 * export default defineZodSchema({
 *   users: Users,
 *   posts: Posts,
 * })
 * ```
 */
export function defineZodSchema<T extends Record<string, ZodTableEntry>>(
  tables: T,
) {
  // Build the Convex table definitions for defineSchema()
  const convexTables: Record<string, any> = {}
  const zodTableMap: ZodTableMap = {}

  for (const [name, entry] of Object.entries(tables)) {
    convexTables[name] = entry.table
    zodTableMap[name] = entry.schema.doc
  }

  // Create the Convex schema and attach the zodTableMap
  const convexSchema = defineSchema(convexTables)

  return Object.assign(convexSchema, { __zodTableMap: zodTableMap })
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test __tests__/schema.test.ts`
Expected: PASS

Note: The `schema.tables` property check depends on what `defineSchema()` returns. If it returns a different shape, adjust the test. The key assertion is that `__zodTableMap` is present and contains the correct doc schemas.

**Step 5: Commit**

```bash
git add src/schema.ts __tests__/schema.test.ts
git commit -m "feat: add defineZodSchema with ZodTableMap capture"
```

---

### Task 4: `CodecQueryChain`

**Files:**
- Create: `src/db.ts`
- Test: `__tests__/db.test.ts`

This is the query chain wrapper. We test it with mocks since we can't run a real Convex DB in unit tests.

**Step 1: Write the failing tests**

```typescript
// __tests__/db.test.ts
import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { CodecQueryChain } from '../src/db'
import { zx } from '../src/zx'

// Schema with a codec field (zx.date)
const userDocSchema = z.object({
  _id: z.string(),
  _creationTime: z.number(),
  name: z.string(),
  createdAt: zx.date(),
})

// Mock query chain — simulates Convex's QueryInitializer/Query/OrderedQuery
function createMockQuery(docs: any[]) {
  const mockQuery: any = {
    fullTableScan: () => mockQuery,
    withIndex: () => mockQuery,
    withSearchIndex: () => mockQuery,
    order: () => mockQuery,
    filter: () => mockQuery,
    first: async () => docs[0] ?? null,
    unique: async () => {
      if (docs.length > 1) throw new Error('not unique')
      return docs[0] ?? null
    },
    collect: async () => docs,
    take: async (n: number) => docs.slice(0, n),
    paginate: async () => ({
      page: docs,
      isDone: true,
      continueCursor: 'cursor',
    }),
    [Symbol.asyncIterator]: async function* () {
      for (const doc of docs) yield doc
    },
  }
  return mockQuery
}

describe('CodecQueryChain', () => {
  const wireDocs = [
    { _id: 'users:1', _creationTime: 100, name: 'Alice', createdAt: 1700000000000 },
    { _id: 'users:2', _creationTime: 200, name: 'Bob', createdAt: 1700100000000 },
  ]

  it('collect() decodes all documents', async () => {
    const chain = new CodecQueryChain(createMockQuery(wireDocs), userDocSchema)
    const results = await chain.collect()

    expect(results).toHaveLength(2)
    expect(results[0].createdAt).toBeInstanceOf(Date)
    expect(results[0].createdAt.getTime()).toBe(1700000000000)
    expect(results[1].createdAt).toBeInstanceOf(Date)
  })

  it('first() decodes a single document', async () => {
    const chain = new CodecQueryChain(createMockQuery(wireDocs), userDocSchema)
    const result = await chain.first()

    expect(result).not.toBeNull()
    expect(result!.createdAt).toBeInstanceOf(Date)
    expect(result!.name).toBe('Alice')
  })

  it('first() returns null for empty results', async () => {
    const chain = new CodecQueryChain(createMockQuery([]), userDocSchema)
    const result = await chain.first()

    expect(result).toBeNull()
  })

  it('unique() decodes a single document', async () => {
    const chain = new CodecQueryChain(createMockQuery([wireDocs[0]]), userDocSchema)
    const result = await chain.unique()

    expect(result).not.toBeNull()
    expect(result!.createdAt).toBeInstanceOf(Date)
  })

  it('take(n) decodes n documents', async () => {
    const chain = new CodecQueryChain(createMockQuery(wireDocs), userDocSchema)
    const results = await chain.take(1)

    expect(results).toHaveLength(1)
    expect(results[0].createdAt).toBeInstanceOf(Date)
  })

  it('paginate() decodes page items', async () => {
    const chain = new CodecQueryChain(createMockQuery(wireDocs), userDocSchema)
    const result = await chain.paginate({ numItems: 10, cursor: null })

    expect(result.page).toHaveLength(2)
    expect(result.page[0].createdAt).toBeInstanceOf(Date)
    expect(result.isDone).toBe(true)
    expect(result.continueCursor).toBe('cursor')
  })

  it('intermediate methods return wrapped chains', async () => {
    const chain = new CodecQueryChain(createMockQuery(wireDocs), userDocSchema)

    // Chain through intermediate methods — should still decode
    const results = await chain.order('asc').collect()
    expect(results[0].createdAt).toBeInstanceOf(Date)
  })

  it('async iteration decodes each document', async () => {
    const chain = new CodecQueryChain(createMockQuery(wireDocs), userDocSchema)
    const results: any[] = []

    for await (const doc of chain) {
      results.push(doc)
    }

    expect(results).toHaveLength(2)
    expect(results[0].createdAt).toBeInstanceOf(Date)
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `bun test __tests__/db.test.ts`
Expected: FAIL — `CodecQueryChain` doesn't exist

**Step 3: Write minimal implementation**

```typescript
// src/db.ts
import type {
  GenericDataModel,
  GenericDatabaseReader,
  GenericDatabaseWriter,
  GenericTableInfo,
  OrderedQuery,
  PaginationOptions,
  PaginationResult,
  Query,
  QueryInitializer,
} from 'convex/server'
import type { GenericId } from 'convex/values'
import type { z } from 'zod'
import { decodeDoc } from './codec'
import type { ZodTableMap } from './schema'

/**
 * Wraps a Convex query chain, decoding documents through a Zod schema
 * at terminal methods (first, unique, collect, take, paginate).
 *
 * Intermediate methods (filter, order, withIndex, etc.) pass through
 * to the inner query — they operate on wire-format data.
 */
export class CodecQueryChain<TableInfo extends GenericTableInfo>
  implements QueryInitializer<TableInfo>
{
  constructor(
    private inner: any, // QueryInitializer | Query | OrderedQuery
    private schema: z.ZodTypeAny,
  ) {}

  // --- Intermediate methods: pass-through, return wrapped ---

  fullTableScan() {
    return new CodecQueryChain<TableInfo>(this.inner.fullTableScan(), this.schema)
  }

  withIndex(indexName: any, indexRange?: any) {
    return new CodecQueryChain<TableInfo>(this.inner.withIndex(indexName, indexRange), this.schema)
  }

  withSearchIndex(indexName: any, searchFilter: any) {
    return new CodecQueryChain<TableInfo>(
      this.inner.withSearchIndex(indexName, searchFilter),
      this.schema,
    )
  }

  order(order: 'asc' | 'desc') {
    return new CodecQueryChain<TableInfo>(this.inner.order(order), this.schema)
  }

  filter(predicate: any) {
    return new CodecQueryChain<TableInfo>(this.inner.filter(predicate), this.schema)
  }

  limit(n: number) {
    return new CodecQueryChain<TableInfo>(this.inner.limit(n), this.schema)
  }

  count(): Promise<number> {
    return this.inner.count()
  }

  // --- Terminal methods: decode at boundary ---

  async first(): Promise<any> {
    const doc = await this.inner.first()
    return doc ? decodeDoc(this.schema, doc) : null
  }

  async unique(): Promise<any> {
    const doc = await this.inner.unique()
    return doc ? decodeDoc(this.schema, doc) : null
  }

  async collect(): Promise<any[]> {
    const docs = await this.inner.collect()
    return docs.map((doc: any) => decodeDoc(this.schema, doc))
  }

  async take(n: number): Promise<any[]> {
    const docs = await this.inner.take(n)
    return docs.map((doc: any) => decodeDoc(this.schema, doc))
  }

  async paginate(paginationOpts: PaginationOptions): Promise<PaginationResult<any>> {
    const result = await this.inner.paginate(paginationOpts)
    return {
      ...result,
      page: result.page.map((doc: any) => decodeDoc(this.schema, doc)),
    }
  }

  // --- AsyncIterable: decode each yielded document ---

  async *[Symbol.asyncIterator](): AsyncIterator<any> {
    for await (const doc of this.inner) {
      yield decodeDoc(this.schema, doc)
    }
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test __tests__/db.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/db.ts __tests__/db.test.ts
git commit -m "feat: add CodecQueryChain with decode at terminal methods"
```

---

### Task 5: `CodecDatabaseReader`

**Files:**
- Modify: `src/db.ts`
- Modify: `__tests__/db.test.ts`

**Step 1: Write the failing tests**

Add to `__tests__/db.test.ts`:

```typescript
import { CodecQueryChain, CodecDatabaseReader } from '../src/db'

// Mock database reader
function createMockDbReader(tables: Record<string, any[]>) {
  const mockDb: any = {
    system: { get: async () => null, query: () => ({}) },
    normalizeId: (tableName: string, id: string) => {
      // Return the id if it starts with "tableName:"
      return id.startsWith(`${tableName}:`) ? id : null
    },
    get: async (idOrTable: string, maybeId?: string) => {
      // Handle get(table, id) form
      if (maybeId !== undefined) {
        const docs = tables[idOrTable] ?? []
        return docs.find((d: any) => d._id === maybeId) ?? null
      }
      // Handle get(id) form — find in any table
      for (const docs of Object.values(tables)) {
        const doc = docs.find((d: any) => d._id === idOrTable)
        if (doc) return doc
      }
      return null
    },
    query: (tableName: string) => {
      const docs = tables[tableName] ?? []
      return createMockQuery(docs)
    },
  }
  return mockDb
}

describe('CodecDatabaseReader', () => {
  const tableMap = {
    users: userDocSchema,
  }

  const tableData = {
    users: [
      { _id: 'users:1', _creationTime: 100, name: 'Alice', createdAt: 1700000000000 },
      { _id: 'users:2', _creationTime: 200, name: 'Bob', createdAt: 1700100000000 },
    ],
  }

  it('get(id) decodes the document', async () => {
    const db = new CodecDatabaseReader(createMockDbReader(tableData), tableMap)
    const user = await db.get('users:1' as any)

    expect(user).not.toBeNull()
    expect(user!.name).toBe('Alice')
    expect(user!.createdAt).toBeInstanceOf(Date)
  })

  it('get(id) returns null for missing documents', async () => {
    const db = new CodecDatabaseReader(createMockDbReader(tableData), tableMap)
    const user = await db.get('users:missing' as any)

    expect(user).toBeNull()
  })

  it('get(table, id) decodes the document', async () => {
    const db = new CodecDatabaseReader(createMockDbReader(tableData), tableMap)
    const user = await db.get('users' as any, 'users:1' as any)

    expect(user).not.toBeNull()
    expect(user!.createdAt).toBeInstanceOf(Date)
  })

  it('query() returns a CodecQueryChain', async () => {
    const db = new CodecDatabaseReader(createMockDbReader(tableData), tableMap)
    const results = await db.query('users' as any).collect()

    expect(results).toHaveLength(2)
    expect(results[0].createdAt).toBeInstanceOf(Date)
  })

  it('passes through for tables not in the zodTableMap', async () => {
    const db = new CodecDatabaseReader(
      createMockDbReader({
        ...tableData,
        logs: [{ _id: 'logs:1', _creationTime: 100, message: 'hello' }],
      }),
      tableMap,
    )

    // 'logs' is not in tableMap — should pass through without decode
    const results = await db.query('logs' as any).collect()
    expect(results[0].message).toBe('hello')
  })

  it('normalizeId passes through to inner db', () => {
    const db = new CodecDatabaseReader(createMockDbReader(tableData), tableMap)
    const result = db.normalizeId('users' as any, 'users:1')

    expect(result).toBe('users:1')
  })

  it('system property passes through to inner db', () => {
    const db = new CodecDatabaseReader(createMockDbReader(tableData), tableMap)
    expect(db.system).toBeDefined()
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `bun test __tests__/db.test.ts`
Expected: FAIL — `CodecDatabaseReader` doesn't exist

**Step 3: Write minimal implementation**

Add to `src/db.ts`:

```typescript
/**
 * Resolves a table name from a GenericId by iterating the tableMap
 * and calling normalizeId. Same approach as convex-helpers' WrapReader.
 */
function resolveTableName<DataModel extends GenericDataModel>(
  db: GenericDatabaseReader<DataModel>,
  tableMap: ZodTableMap,
  id: GenericId<any>,
): string | null {
  for (const tableName of Object.keys(tableMap)) {
    if (db.normalizeId(tableName as any, id as unknown as string)) {
      return tableName
    }
  }
  return null
}

/**
 * Wraps a GenericDatabaseReader with automatic Zod codec decoding on reads.
 * Documents from tables in the zodTableMap are decoded through their schema.
 * Tables not in the map pass through without decoding.
 * System tables always pass through.
 */
export class CodecDatabaseReader<DataModel extends GenericDataModel>
  implements GenericDatabaseReader<DataModel>
{
  system: GenericDatabaseReader<DataModel>['system']

  constructor(
    protected db: GenericDatabaseReader<DataModel>,
    protected tableMap: ZodTableMap,
  ) {
    this.system = db.system
  }

  normalizeId<TableName extends string>(
    tableName: TableName,
    id: string,
  ): GenericId<TableName> | null {
    return this.db.normalizeId(tableName as any, id) as GenericId<TableName> | null
  }

  async get(idOrTable: any, maybeId?: any): Promise<any> {
    let tableName: string | null
    let doc: any

    if (maybeId !== undefined) {
      // get(table, id) form
      tableName = idOrTable
      doc = await this.db.get(idOrTable, maybeId)
    } else {
      // get(id) form
      doc = await this.db.get(idOrTable)
      tableName = doc ? resolveTableName(this.db, this.tableMap, idOrTable) : null
    }

    if (!doc) return null

    const schema = tableName ? this.tableMap[tableName] : undefined
    return schema ? decodeDoc(schema, doc) : doc
  }

  query(tableName: any): any {
    const schema = this.tableMap[tableName as string]
    const innerQuery = this.db.query(tableName)
    if (!schema) return innerQuery
    return new CodecQueryChain(innerQuery, schema)
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test __tests__/db.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/db.ts __tests__/db.test.ts
git commit -m "feat: add CodecDatabaseReader with auto-decode on reads"
```

---

### Task 6: `CodecDatabaseWriter`

**Files:**
- Modify: `src/db.ts`
- Modify: `__tests__/db.test.ts`

**Step 1: Write the failing tests**

Add to `__tests__/db.test.ts`:

```typescript
import { CodecQueryChain, CodecDatabaseReader, CodecDatabaseWriter } from '../src/db'
import { encodeDoc, encodePartialDoc } from '../src/codec'

// Mock database writer — tracks calls for assertions
function createMockDbWriter(tables: Record<string, any[]>) {
  const calls: { method: string; args: any[] }[] = []

  const reader = createMockDbReader(tables)

  const mockDb: any = {
    ...reader,
    insert: async (table: string, value: any) => {
      calls.push({ method: 'insert', args: [table, value] })
      return `${table}:new` // return a mock id
    },
    patch: async (id: any, value: any) => {
      calls.push({ method: 'patch', args: [id, value] })
    },
    replace: async (id: any, value: any) => {
      calls.push({ method: 'replace', args: [id, value] })
    },
    delete: async (id: any) => {
      calls.push({ method: 'delete', args: [id] })
    },
  }

  return { db: mockDb, calls }
}

describe('CodecDatabaseWriter', () => {
  const tableMap = {
    users: userDocSchema,
  }

  const tableData = {
    users: [
      { _id: 'users:1', _creationTime: 100, name: 'Alice', createdAt: 1700000000000 },
    ],
  }

  it('insert() encodes runtime values to wire format', async () => {
    const { db: mockDb, calls } = createMockDbWriter(tableData)
    const db = new CodecDatabaseWriter(mockDb, tableMap)

    const id = await db.insert('users' as any, {
      name: 'Charlie',
      createdAt: new Date(1700000000000),
    } as any)

    expect(id).toBe('users:new')
    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe('insert')
    expect(calls[0].args[0]).toBe('users')
    expect(calls[0].args[1].createdAt).toBe(1700000000000) // encoded
    expect(calls[0].args[1].name).toBe('Charlie')
  })

  it('patch() encodes partial runtime values', async () => {
    const { db: mockDb, calls } = createMockDbWriter(tableData)
    const db = new CodecDatabaseWriter(mockDb, tableMap)

    await db.patch('users:1' as any, {
      createdAt: new Date(1800000000000),
    } as any)

    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe('patch')
    expect(calls[0].args[1].createdAt).toBe(1800000000000) // encoded
  })

  it('replace() encodes full runtime document', async () => {
    const { db: mockDb, calls } = createMockDbWriter(tableData)
    const db = new CodecDatabaseWriter(mockDb, tableMap)

    await db.replace('users:1' as any, {
      name: 'Alice Updated',
      createdAt: new Date(1800000000000),
    } as any)

    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe('replace')
    expect(calls[0].args[1].createdAt).toBe(1800000000000)
  })

  it('delete() passes through without encoding', async () => {
    const { db: mockDb, calls } = createMockDbWriter(tableData)
    const db = new CodecDatabaseWriter(mockDb, tableMap)

    await db.delete('users:1' as any)

    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe('delete')
    expect(calls[0].args[0]).toBe('users:1')
  })

  it('read methods delegate to CodecDatabaseReader', async () => {
    const { db: mockDb } = createMockDbWriter(tableData)
    const db = new CodecDatabaseWriter(mockDb, tableMap)

    // get should decode
    const user = await db.get('users:1' as any)
    expect(user).not.toBeNull()
    expect(user!.createdAt).toBeInstanceOf(Date)

    // query should return CodecQueryChain
    const results = await db.query('users' as any).collect()
    expect(results[0].createdAt).toBeInstanceOf(Date)
  })

  it('passes through writes for tables not in zodTableMap', async () => {
    const { db: mockDb, calls } = createMockDbWriter(tableData)
    const db = new CodecDatabaseWriter(mockDb, tableMap)

    await db.insert('logs' as any, { message: 'hello' } as any)

    expect(calls).toHaveLength(1)
    expect(calls[0].args[1]).toEqual({ message: 'hello' }) // not encoded
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `bun test __tests__/db.test.ts`
Expected: FAIL — `CodecDatabaseWriter` doesn't exist

**Step 3: Write minimal implementation**

Add to `src/db.ts`:

```typescript
import { encodeDoc, encodePartialDoc } from './codec'

/**
 * Wraps a GenericDatabaseWriter with automatic Zod codec encoding on writes
 * and decoding on reads. Delegates read operations to a CodecDatabaseReader.
 */
export class CodecDatabaseWriter<DataModel extends GenericDataModel>
  implements GenericDatabaseWriter<DataModel>
{
  private reader: CodecDatabaseReader<DataModel>
  system: GenericDatabaseWriter<DataModel>['system']

  constructor(
    private db: GenericDatabaseWriter<DataModel>,
    private tableMap: ZodTableMap,
  ) {
    this.reader = new CodecDatabaseReader(db, tableMap)
    this.system = db.system
  }

  // --- Read methods: delegate to reader ---

  normalizeId(tableName: any, id: string): any {
    return this.reader.normalizeId(tableName, id)
  }

  get(idOrTable: any, maybeId?: any): Promise<any> {
    return this.reader.get(idOrTable, maybeId)
  }

  query(tableName: any): any {
    return this.reader.query(tableName)
  }

  // --- Write methods: encode before delegating ---

  async insert(table: any, value: any): Promise<any> {
    const schema = this.tableMap[table as string]
    if (schema) {
      // Use the base schema (without system fields) for insert encoding
      // System fields (_id, _creationTime) are added by Convex, not by us
      const wireValue = encodeDoc(schema, value)
      return this.db.insert(table, wireValue)
    }
    return this.db.insert(table, value)
  }

  async patch(idOrTable: any, idOrValue: any, maybeValue?: any): Promise<void> {
    let tableName: string | null
    let id: any
    let value: any

    if (maybeValue !== undefined) {
      // patch(table, id, value) form
      tableName = idOrTable
      id = idOrValue
      value = maybeValue
    } else {
      // patch(id, value) form
      id = idOrTable
      value = idOrValue
      tableName = resolveTableName(this.db, this.tableMap, id)
    }

    const schema = tableName ? this.tableMap[tableName] : undefined
    if (schema) {
      const wireValue = encodePartialDoc(schema, value)
      return maybeValue !== undefined
        ? this.db.patch(idOrTable, id, wireValue)
        : this.db.patch(id, wireValue)
    }

    return maybeValue !== undefined
      ? this.db.patch(idOrTable, idOrValue, maybeValue)
      : this.db.patch(idOrTable, idOrValue)
  }

  async replace(idOrTable: any, idOrValue: any, maybeValue?: any): Promise<void> {
    let tableName: string | null
    let id: any
    let value: any

    if (maybeValue !== undefined) {
      tableName = idOrTable
      id = idOrValue
      value = maybeValue
    } else {
      id = idOrTable
      value = idOrValue
      tableName = resolveTableName(this.db, this.tableMap, id)
    }

    const schema = tableName ? this.tableMap[tableName] : undefined
    if (schema) {
      const wireValue = encodeDoc(schema, value)
      return maybeValue !== undefined
        ? this.db.replace(idOrTable, id, wireValue)
        : this.db.replace(id, wireValue)
    }

    return maybeValue !== undefined
      ? this.db.replace(idOrTable, idOrValue, maybeValue)
      : this.db.replace(idOrTable, idOrValue)
  }

  async delete(idOrTable: any, maybeId?: any): Promise<void> {
    return maybeId !== undefined
      ? this.db.delete(idOrTable, maybeId)
      : this.db.delete(idOrTable)
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test __tests__/db.test.ts`
Expected: PASS

Note: The `insert` encoding is intentionally simple here. The doc schema includes system fields (`_id`, `_creationTime`) which won't be in the insert value. `z.encode()` on a partial may need adjustment — if it fails because required system fields are missing, we'll need to use the base schema (`schema.base` or strip system fields) instead. Handle this in the implementation if tests reveal the issue.

**Step 5: Commit**

```bash
git add src/db.ts __tests__/db.test.ts
git commit -m "feat: add CodecDatabaseWriter with auto-encode on writes"
```

---

### Task 7: Factory Functions

**Files:**
- Modify: `src/db.ts`
- Modify: `__tests__/db.test.ts`

**Step 1: Write the failing tests**

Add to `__tests__/db.test.ts`:

```typescript
import {
  CodecQueryChain,
  CodecDatabaseReader,
  CodecDatabaseWriter,
  createZodDbReader,
  createZodDbWriter,
} from '../src/db'

describe('createZodDbReader', () => {
  const tableData = {
    users: [
      { _id: 'users:1', _creationTime: 100, name: 'Alice', createdAt: 1700000000000 },
    ],
  }

  it('creates a CodecDatabaseReader from schema with __zodTableMap', async () => {
    const schema = { __zodTableMap: { users: userDocSchema } }
    const db = createZodDbReader(createMockDbReader(tableData) as any, schema)

    const user = await db.get('users:1' as any)
    expect(user).not.toBeNull()
    expect(user!.createdAt).toBeInstanceOf(Date)
  })
})

describe('createZodDbWriter', () => {
  const tableData = {
    users: [
      { _id: 'users:1', _creationTime: 100, name: 'Alice', createdAt: 1700000000000 },
    ],
  }

  it('creates a CodecDatabaseWriter from schema with __zodTableMap', async () => {
    const schema = { __zodTableMap: { users: userDocSchema } }
    const { db: mockDb, calls } = createMockDbWriter(tableData)
    const db = createZodDbWriter(mockDb as any, schema)

    await db.insert('users' as any, {
      name: 'New',
      createdAt: new Date(1700000000000),
    } as any)

    expect(calls[0].args[1].createdAt).toBe(1700000000000)
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `bun test __tests__/db.test.ts`
Expected: FAIL — `createZodDbReader` and `createZodDbWriter` don't exist

**Step 3: Write minimal implementation**

Add to `src/db.ts`:

```typescript
/**
 * Creates a CodecDatabaseReader from a Convex DatabaseReader and a schema
 * with __zodTableMap (as returned by defineZodSchema).
 */
export function createZodDbReader<DataModel extends GenericDataModel>(
  db: GenericDatabaseReader<DataModel>,
  schema: { __zodTableMap: ZodTableMap },
): CodecDatabaseReader<DataModel> {
  return new CodecDatabaseReader(db, schema.__zodTableMap)
}

/**
 * Creates a CodecDatabaseWriter from a Convex DatabaseWriter and a schema
 * with __zodTableMap (as returned by defineZodSchema).
 */
export function createZodDbWriter<DataModel extends GenericDataModel>(
  db: GenericDatabaseWriter<DataModel>,
  schema: { __zodTableMap: ZodTableMap },
): CodecDatabaseWriter<DataModel> {
  return new CodecDatabaseWriter(db, schema.__zodTableMap)
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test __tests__/db.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/db.ts __tests__/db.test.ts
git commit -m "feat: add createZodDbReader/Writer factory functions"
```

---

### Task 8: Export Wiring + Export Tests

**Files:**
- Modify: `src/core/index.ts`
- Modify: `src/server/index.ts`
- Modify: `__tests__/exports.test.ts`

**Step 1: Write the failing export tests**

Add to `__tests__/exports.test.ts`:

In the `zodvex/core exports` describe block:

```typescript
  it('exports doc codec primitives', async () => {
    const { decodeDoc, encodeDoc, encodePartialDoc } = await import('../src/core')
    expect(decodeDoc).toBeDefined()
    expect(encodeDoc).toBeDefined()
    expect(encodePartialDoc).toBeDefined()
  })
```

In the `zodvex/server exports` describe block:

```typescript
  it('exports defineZodSchema', async () => {
    const { defineZodSchema } = await import('../src/server')
    expect(defineZodSchema).toBeDefined()
  })

  it('exports DB wrapper classes', async () => {
    const { CodecDatabaseReader, CodecDatabaseWriter, CodecQueryChain } = await import(
      '../src/server'
    )
    expect(CodecDatabaseReader).toBeDefined()
    expect(CodecDatabaseWriter).toBeDefined()
    expect(CodecQueryChain).toBeDefined()
  })

  it('exports DB factory functions', async () => {
    const { createZodDbReader, createZodDbWriter } = await import('../src/server')
    expect(createZodDbReader).toBeDefined()
    expect(createZodDbWriter).toBeDefined()
  })
```

In the `zodvex (root) exports` describe block, add to the existing test:

```typescript
    // New codec DB exports
    expect(zodvex.decodeDoc).toBeDefined()
    expect(zodvex.encodeDoc).toBeDefined()
    expect(zodvex.defineZodSchema).toBeDefined()
    expect(zodvex.createZodDbReader).toBeDefined()
    expect(zodvex.createZodDbWriter).toBeDefined()
```

**Step 2: Run tests to verify they fail**

Run: `bun test __tests__/exports.test.ts`
Expected: FAIL — new exports not wired up

**Step 3: Wire up exports**

Modify `src/core/index.ts` — add:

```typescript
// Schema definition (ZodTableMap type only — defineZodSchema is server-only)
export type { ZodTableMap } from '../schema'
```

Note: `decodeDoc`, `encodeDoc`, `encodePartialDoc` are already in `src/codec.ts` which is re-exported via `export * from '../codec'`. No change needed for those.

Modify `src/server/index.ts` — add:

```typescript
// Schema definition
export * from '../schema'
// Database wrappers
export * from '../db'
```

**Step 4: Run tests to verify they pass**

Run: `bun test __tests__/exports.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `bun test`
Expected: ALL PASS

**Step 6: Run type-check**

Run: `bun run type-check`
Expected: PASS

**Step 7: Commit**

```bash
git add src/core/index.ts src/server/index.ts __tests__/exports.test.ts
git commit -m "feat: wire up codec DB exports (core + server)"
```

---

### Task 9: Build Verification

**Step 1: Run the full build**

Run: `bun run build`
Expected: PASS — tsup builds without errors

**Step 2: Run the full test suite one more time**

Run: `bun test`
Expected: ALL PASS

**Step 3: Run lint**

Run: `bun run lint`
Expected: PASS (or fix any issues)

**Step 4: Final commit if any lint fixes**

```bash
git add -A
git commit -m "chore: lint fixes"
```
