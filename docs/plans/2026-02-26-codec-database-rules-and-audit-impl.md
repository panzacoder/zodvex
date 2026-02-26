# Codec Database Rules & Audit Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `.withRules()` and `.audit()` methods to `CodecDatabaseReader`/`CodecDatabaseWriter` for per-table, per-operation rules and post-operation audit callbacks.

**Architecture:** Subclass-based. `.withRules()` returns a `RulesCodecDatabaseReader`/`Writer` that extends the base class and overrides `get()`/`query()`/write methods. `.audit()` returns an `AuditCodecDatabaseReader`/`Writer` that overrides terminals to fire callbacks. Both return the same parent type, enabling natural chaining.

**Tech Stack:** TypeScript, Bun test runner, Zod v4, Convex server types

**Design doc:** `docs/plans/2026-02-26-codec-database-rules-and-audit-design.md`

---

### Task 1: Types — Define Rule and Audit Types

**Files:**
- Create: `packages/zodvex/src/rules.ts`
- Test: `packages/zodvex/__tests__/rules.test.ts`

**Step 1: Create the types file with all public types**

Create `packages/zodvex/src/rules.ts`:

```ts
import type {
  GenericDataModel,
  GenericId,
  TableNamesInDataModel,
} from 'convex/server'

/**
 * Per-document rule function. Gates and optionally transforms documents.
 * Return the doc (possibly transformed) to allow, null to deny.
 */
export type ReadRule<Ctx, Doc> = (ctx: Ctx, doc: Doc) => Promise<Doc | null>

/**
 * Per-insert rule. Gates and optionally transforms the insert value.
 * Return the value (possibly transformed) to allow. Throw to deny.
 */
export type InsertRule<Ctx> = (ctx: Ctx, value: any) => Promise<any>

/**
 * Per-patch rule. Receives current doc + patch value.
 * Return the patch value (possibly transformed) to allow. Throw to deny.
 */
export type PatchRule<Ctx, Doc> = (
  ctx: Ctx,
  doc: Doc,
  value: Partial<Doc>,
) => Promise<Partial<Doc>>

/**
 * Per-replace rule. Receives current doc + full replacement value.
 * Return the replacement (possibly transformed) to allow. Throw to deny.
 */
export type ReplaceRule<Ctx, Doc> = (
  ctx: Ctx,
  doc: Doc,
  value: Doc,
) => Promise<Doc>

/**
 * Per-delete rule. Receives current doc. Throw to deny.
 */
export type DeleteRule<Ctx, Doc> = (ctx: Ctx, doc: Doc) => Promise<void>

/**
 * Rules for a single table, organized by database operation.
 */
export type TableRules<Ctx, Doc> = {
  read?: ReadRule<Ctx, Doc>
  insert?: InsertRule<Ctx>
  patch?: PatchRule<Ctx, Doc>
  replace?: ReplaceRule<Ctx, Doc>
  delete?: DeleteRule<Ctx, Doc>
}

/**
 * Per-table rules for all tables in the data model.
 * Tables not listed are unaffected by rules (regardless of defaultPolicy).
 */
export type CodecRules<
  Ctx,
  DataModel extends GenericDataModel,
  DecodedDocs extends Record<string, any>,
> = {
  [T in TableNamesInDataModel<DataModel>]?: TableRules<
    Ctx,
    ResolveDecodedDocForRules<DataModel, DecodedDocs, T>
  >
}

/**
 * Resolves the decoded doc type for a table. Mirrors ResolveDecodedDoc from db.ts
 * but exported for consumer use in rule definitions.
 */
export type ResolveDecodedDocForRules<
  DataModel extends GenericDataModel,
  DecodedDocs extends Record<string, any>,
  TableName extends TableNamesInDataModel<DataModel>,
> = TableName extends keyof DecodedDocs ? DecodedDocs[TableName] : any

/**
 * Configuration for .withRules().
 */
export type CodecRulesConfig = {
  /** Default policy for operations without rules on tables that ARE listed. Default: 'allow'. */
  defaultPolicy?: 'allow' | 'deny'
  /** Allow count() when rules are present. Default: false. */
  allowCounting?: boolean
}

/**
 * Describes a completed write operation for audit callbacks.
 */
export type WriteEvent =
  | { type: 'insert'; id: GenericId<any>; value: any }
  | { type: 'patch'; id: GenericId<any>; doc: any; value: any }
  | { type: 'replace'; id: GenericId<any>; doc: any; value: any }
  | { type: 'delete'; id: GenericId<any>; doc: any }

/**
 * Audit configuration for .audit() on a reader.
 */
export type ReaderAuditConfig = {
  afterRead?: (table: string, doc: any) => void | Promise<void>
}

/**
 * Audit configuration for .audit() on a writer.
 */
export type WriterAuditConfig = {
  afterRead?: (table: string, doc: any) => void | Promise<void>
  afterWrite?: (table: string, event: WriteEvent) => void | Promise<void>
}
```

**Step 2: Create a minimal test to verify types import**

Create `packages/zodvex/__tests__/rules.test.ts`:

```ts
import { describe, expect, it } from 'bun:test'
import type {
  CodecRules,
  CodecRulesConfig,
  TableRules,
  WriteEvent,
  ReaderAuditConfig,
  WriterAuditConfig,
} from '../src/rules'

describe('rules types', () => {
  it('exports all public types', () => {
    // Type-level assertions — if this compiles, the types are correctly exported.
    // Runtime assertion just confirms the test ran.
    const config: CodecRulesConfig = { defaultPolicy: 'allow', allowCounting: false }
    expect(config.defaultPolicy).toBe('allow')
  })

  it('WriteEvent discriminates by type', () => {
    const event: WriteEvent = { type: 'insert', id: 'test:1' as any, value: { name: 'Alice' } }
    expect(event.type).toBe('insert')
  })
})
```

**Step 3: Run tests to verify they pass**

Run: `bun test packages/zodvex/__tests__/rules.test.ts`
Expected: PASS (2 tests)

**Step 4: Commit**

```bash
git add packages/zodvex/src/rules.ts packages/zodvex/__tests__/rules.test.ts
git commit -m "feat: add rule and audit types for codec database wrapping"
```

---

### Task 2: RulesCodecQueryChain — Rule-Filtered Query Chain

**Files:**
- Modify: `packages/zodvex/src/rules.ts`
- Test: `packages/zodvex/__tests__/rules.test.ts`

This is the core of the read-path. `RulesCodecQueryChain` wraps a `CodecQueryChain` and applies the read rule at every terminal method.

**Step 1: Write failing tests for RulesCodecQueryChain**

Add to `packages/zodvex/__tests__/rules.test.ts`:

```ts
import { z } from 'zod'
import { CodecQueryChain } from '../src/db'
import { RulesCodecQueryChain } from '../src/rules'
import { zx } from '../src/zx'

const docSchema = z.object({
  _id: z.string(),
  _creationTime: z.number(),
  name: z.string(),
  createdAt: zx.date(),
  role: z.string(),
})

// Helper: creates a CodecQueryChain backed by mock docs
function createCodecChain(docs: any[]) {
  const mockQuery: any = {
    fullTableScan: () => mockQuery,
    withIndex: () => mockQuery,
    withSearchIndex: () => mockQuery,
    order: () => mockQuery,
    filter: () => mockQuery,
    limit: () => mockQuery,
    count: async () => docs.length,
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
  return new CodecQueryChain(mockQuery, docSchema)
}

// Wire-format docs (createdAt is a timestamp number)
const wireDocs = [
  { _id: 'u:1', _creationTime: 100, name: 'Alice', createdAt: 1700000000000, role: 'admin' },
  { _id: 'u:2', _creationTime: 200, name: 'Bob', createdAt: 1700100000000, role: 'user' },
  { _id: 'u:3', _creationTime: 300, name: 'Charlie', createdAt: 1700200000000, role: 'user' },
]

describe('RulesCodecQueryChain', () => {
  const allowAll = async (_ctx: any, doc: any) => doc
  const denyAll = async (_ctx: any, _doc: any) => null
  const adminsOnly = async (_ctx: any, doc: any) =>
    doc.role === 'admin' ? doc : null

  it('collect() returns all docs when rule allows all', async () => {
    const chain = new RulesCodecQueryChain(createCodecChain(wireDocs), 'users', allowAll, {})
    const results = await chain.collect()
    expect(results).toHaveLength(3)
    expect(results[0].createdAt).toBeInstanceOf(Date)
  })

  it('collect() filters docs through read rule', async () => {
    const chain = new RulesCodecQueryChain(createCodecChain(wireDocs), 'users', adminsOnly, {})
    const results = await chain.collect()
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('Alice')
  })

  it('collect() returns empty array when rule denies all', async () => {
    const chain = new RulesCodecQueryChain(createCodecChain(wireDocs), 'users', denyAll, {})
    const results = await chain.collect()
    expect(results).toHaveLength(0)
  })

  it('first() returns first allowed doc, skipping denied', async () => {
    // Bob and Charlie are users, Alice is admin. If we deny admins:
    const usersOnly = async (_ctx: any, doc: any) =>
      doc.role === 'user' ? doc : null
    const chain = new RulesCodecQueryChain(createCodecChain(wireDocs), 'users', usersOnly, {})
    const result = await chain.first()
    expect(result).not.toBeNull()
    expect(result?.name).toBe('Bob')
  })

  it('first() returns null when no docs pass the rule', async () => {
    const chain = new RulesCodecQueryChain(createCodecChain(wireDocs), 'users', denyAll, {})
    const result = await chain.first()
    expect(result).toBeNull()
  })

  it('take(n) collects n allowed docs, skipping denied', async () => {
    const usersOnly = async (_ctx: any, doc: any) =>
      doc.role === 'user' ? doc : null
    const chain = new RulesCodecQueryChain(createCodecChain(wireDocs), 'users', usersOnly, {})
    const results = await chain.take(1)
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('Bob')
  })

  it('unique() applies rule and returns doc if allowed', async () => {
    const singleDoc = [wireDocs[0]]
    const chain = new RulesCodecQueryChain(createCodecChain(singleDoc), 'users', allowAll, {})
    const result = await chain.unique()
    expect(result).not.toBeNull()
    expect(result?.name).toBe('Alice')
  })

  it('unique() returns null when rule denies', async () => {
    const singleDoc = [wireDocs[0]]
    const chain = new RulesCodecQueryChain(createCodecChain(singleDoc), 'users', denyAll, {})
    const result = await chain.unique()
    expect(result).toBeNull()
  })

  it('paginate() post-filters the page (page may shrink)', async () => {
    const chain = new RulesCodecQueryChain(createCodecChain(wireDocs), 'users', adminsOnly, {})
    const result = await chain.paginate({ numItems: 10, cursor: null })
    expect(result.page).toHaveLength(1)
    expect(result.page[0].name).toBe('Alice')
    expect(result.isDone).toBe(true)
  })

  it('count() throws when allowCounting is false', async () => {
    const chain = new RulesCodecQueryChain(createCodecChain(wireDocs), 'users', allowAll, {
      allowCounting: false,
    })
    await expect(chain.count()).rejects.toThrow('count is not allowed with rules')
  })

  it('count() delegates when allowCounting is true', async () => {
    const chain = new RulesCodecQueryChain(createCodecChain(wireDocs), 'users', allowAll, {
      allowCounting: true,
    })
    const count = await chain.count()
    expect(count).toBe(3)
  })

  it('read rule can transform documents', async () => {
    const transform = async (_ctx: any, doc: any) => ({ ...doc, name: doc.name.toUpperCase() })
    const chain = new RulesCodecQueryChain(createCodecChain(wireDocs), 'users', transform, {})
    const results = await chain.collect()
    expect(results[0].name).toBe('ALICE')
  })

  it('async iteration filters through rule', async () => {
    const chain = new RulesCodecQueryChain(createCodecChain(wireDocs), 'users', adminsOnly, {})
    const results: any[] = []
    for await (const doc of chain) {
      results.push(doc)
    }
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('Alice')
  })

  it('intermediate methods delegate and re-wrap', async () => {
    const chain = new RulesCodecQueryChain(createCodecChain(wireDocs), 'users', adminsOnly, {})
    const results = await chain.order('asc').filter(() => true).collect()
    expect(results).toHaveLength(1)
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `bun test packages/zodvex/__tests__/rules.test.ts`
Expected: FAIL — `RulesCodecQueryChain` is not exported

**Step 3: Implement RulesCodecQueryChain**

Add to `packages/zodvex/src/rules.ts`:

```ts
import type { GenericTableInfo, PaginationOptions, PaginationResult } from 'convex/server'
import { CodecQueryChain } from './db'

/**
 * Wraps a CodecQueryChain, applying a read rule at every terminal method.
 * Intermediate methods delegate to the inner chain and re-wrap.
 *
 * The read rule receives decoded docs (from the inner chain's terminals)
 * and returns the doc (possibly transformed) to allow, or null to deny.
 */
export class RulesCodecQueryChain<TableInfo extends GenericTableInfo, Doc> {
  constructor(
    private inner: CodecQueryChain<TableInfo, Doc>,
    private tableName: string,
    private readRule: ReadRule<any, Doc>,
    private config: CodecRulesConfig,
  ) {}

  // --- Intermediate methods: delegate and re-wrap ---

  fullTableScan(): RulesCodecQueryChain<TableInfo, Doc> {
    return new RulesCodecQueryChain(this.inner.fullTableScan() as any, this.tableName, this.readRule, this.config)
  }

  withIndex(...args: any[]): RulesCodecQueryChain<TableInfo, Doc> {
    return new RulesCodecQueryChain((this.inner as any).withIndex(...args), this.tableName, this.readRule, this.config)
  }

  withSearchIndex(...args: any[]): RulesCodecQueryChain<TableInfo, Doc> {
    return new RulesCodecQueryChain((this.inner as any).withSearchIndex(...args), this.tableName, this.readRule, this.config)
  }

  order(order: 'asc' | 'desc'): RulesCodecQueryChain<TableInfo, Doc> {
    return new RulesCodecQueryChain(this.inner.order(order) as any, this.tableName, this.readRule, this.config)
  }

  filter(predicate: any): RulesCodecQueryChain<TableInfo, Doc> {
    return new RulesCodecQueryChain(this.inner.filter(predicate) as any, this.tableName, this.readRule, this.config)
  }

  limit(n: number): RulesCodecQueryChain<TableInfo, Doc> {
    return new RulesCodecQueryChain(this.inner.limit(n) as any, this.tableName, this.readRule, this.config)
  }

  // --- Terminal methods: apply read rule ---

  async first(): Promise<Doc | null> {
    for await (const doc of this.inner) {
      const result = await this.readRule({}, doc)
      if (result !== null) return result
    }
    return null
  }

  async unique(): Promise<Doc | null> {
    const doc = await this.inner.unique()
    if (doc === null) return null
    return this.readRule({}, doc)
  }

  async collect(): Promise<Doc[]> {
    const results: Doc[] = []
    for await (const doc of this.inner) {
      const result = await this.readRule({}, doc)
      if (result !== null) results.push(result)
    }
    return results
  }

  async take(n: number): Promise<Doc[]> {
    const results: Doc[] = []
    for await (const doc of this.inner) {
      if (results.length >= n) break
      const result = await this.readRule({}, doc)
      if (result !== null) results.push(result)
    }
    return results
  }

  async paginate(opts: PaginationOptions): Promise<PaginationResult<Doc>> {
    const result = await this.inner.paginate(opts)
    const filtered: Doc[] = []
    for (const doc of result.page) {
      const allowed = await this.readRule({}, doc)
      if (allowed !== null) filtered.push(allowed)
    }
    return { ...result, page: filtered }
  }

  async count(): Promise<number> {
    if (!this.config.allowCounting) {
      throw new Error('count is not allowed with rules')
    }
    return this.inner.count()
  }

  async *[Symbol.asyncIterator](): AsyncIterator<Doc> {
    for await (const doc of this.inner) {
      const result = await this.readRule({}, doc)
      if (result !== null) yield result
    }
  }
}
```

**Important:** The `readRule` is called with `{}` as the ctx placeholder above. The actual ctx will be captured when `RulesCodecDatabaseReader` constructs the chain — it passes the ctx through. Update the constructor to accept `ctx`:

Replace the constructor and all `this.readRule({}, doc)` calls with `this.readRule(this.ctx, doc)`:

```ts
constructor(
  private inner: CodecQueryChain<TableInfo, Doc>,
  private tableName: string,
  private readRule: ReadRule<any, Doc>,
  private config: CodecRulesConfig,
  private ctx: any = {},
) {}
```

And all calls become `this.readRule(this.ctx, doc)`.

**Step 4: Run tests to verify they pass**

Run: `bun test packages/zodvex/__tests__/rules.test.ts`
Expected: PASS (all tests)

**Step 5: Commit**

```bash
git add packages/zodvex/src/rules.ts packages/zodvex/__tests__/rules.test.ts
git commit -m "feat: add RulesCodecQueryChain with per-doc read rule filtering"
```

---

### Task 3: RulesCodecDatabaseReader — Read-Side Rule Wrapping

**Files:**
- Modify: `packages/zodvex/src/rules.ts`
- Modify: `packages/zodvex/src/db.ts` (add `.withRules()` method)
- Test: `packages/zodvex/__tests__/rules.test.ts`

**Step 1: Write failing tests for withRules() on reader**

Add to `packages/zodvex/__tests__/rules.test.ts`:

```ts
import { CodecDatabaseReader } from '../src/db'
import type { ZodTableSchemas } from '../src/schema'

const userDocSchema = z.object({
  _id: z.string(),
  _creationTime: z.number(),
  name: z.string(),
  createdAt: zx.date(),
  role: z.string(),
})

const userInsertSchema = z.object({
  name: z.string(),
  createdAt: zx.date(),
  role: z.string(),
})

const userSchemas: ZodTableSchemas = {
  doc: userDocSchema,
  docArray: z.array(userDocSchema),
  base: userInsertSchema,
  insert: userInsertSchema,
  update: userInsertSchema.partial().extend({ _id: z.string() }),
  paginatedDoc: z.object({ page: z.array(userDocSchema), isDone: z.boolean(), continueCursor: z.string() }),
}

// Reuse createMockDbReader from db.test.ts pattern
function createMockDbReader(tables: Record<string, any[]>) {
  const mockDb: any = {
    system: { get: async () => null, query: () => ({}), normalizeId: () => null },
    normalizeId: (tableName: string, id: string) => {
      return id.startsWith(`${tableName}:`) ? id : null
    },
    get: async (idOrTable: string, maybeId?: string) => {
      if (maybeId !== undefined) {
        const docs = tables[idOrTable] ?? []
        return docs.find((d: any) => d._id === maybeId) ?? null
      }
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

function createMockQuery(docs: any[]) {
  const mockQuery: any = {
    fullTableScan: () => mockQuery,
    withIndex: () => mockQuery,
    withSearchIndex: () => mockQuery,
    order: () => mockQuery,
    filter: () => mockQuery,
    limit: () => mockQuery,
    count: async () => docs.length,
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

const tableMap = { users: userSchemas }
const tableData = {
  users: [
    { _id: 'users:1', _creationTime: 100, name: 'Alice', createdAt: 1700000000000, role: 'admin' },
    { _id: 'users:2', _creationTime: 200, name: 'Bob', createdAt: 1700100000000, role: 'user' },
  ],
}

describe('CodecDatabaseReader.withRules()', () => {
  it('get() applies read rule and returns allowed doc', async () => {
    const db = new CodecDatabaseReader(createMockDbReader(tableData), tableMap)
    const secureDb = db.withRules({}, {
      users: { read: async (_ctx, doc) => doc },
    })
    const user = await secureDb.get('users:1' as any)
    expect(user).not.toBeNull()
    expect(user?.name).toBe('Alice')
    expect(user?.createdAt).toBeInstanceOf(Date)
  })

  it('get() returns null when read rule denies', async () => {
    const db = new CodecDatabaseReader(createMockDbReader(tableData), tableMap)
    const secureDb = db.withRules({}, {
      users: { read: async () => null },
    })
    const user = await secureDb.get('users:1' as any)
    expect(user).toBeNull()
  })

  it('get() passes context to read rule', async () => {
    const ctx = { clinicId: 'c1' }
    const db = new CodecDatabaseReader(createMockDbReader(tableData), tableMap)
    const secureDb = db.withRules(ctx, {
      users: {
        read: async (ctx, doc) => {
          expect(ctx.clinicId).toBe('c1')
          return doc
        },
      },
    })
    await secureDb.get('users:1' as any)
  })

  it('query().collect() filters through read rule', async () => {
    const db = new CodecDatabaseReader(createMockDbReader(tableData), tableMap)
    const secureDb = db.withRules({}, {
      users: { read: async (_ctx, doc) => (doc.role === 'admin' ? doc : null) },
    })
    const results = await secureDb.query('users' as any).collect()
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('Alice')
  })

  it('read rule can transform documents', async () => {
    const db = new CodecDatabaseReader(createMockDbReader(tableData), tableMap)
    const secureDb = db.withRules({}, {
      users: { read: async (_ctx, doc) => ({ ...doc, name: doc.name.toUpperCase() }) },
    })
    const user = await secureDb.get('users:1' as any)
    expect(user?.name).toBe('ALICE')
  })

  it('tables without rules pass through unchanged', async () => {
    const db = new CodecDatabaseReader(createMockDbReader(tableData), tableMap)
    const secureDb = db.withRules({}, {})
    const user = await secureDb.get('users:1' as any)
    expect(user).not.toBeNull()
    expect(user?.name).toBe('Alice')
  })

  it('normalizeId and system pass through', () => {
    const db = new CodecDatabaseReader(createMockDbReader(tableData), tableMap)
    const secureDb = db.withRules({}, {})
    expect(secureDb.normalizeId('users' as any, 'users:1')).toBe('users:1')
    expect(secureDb.system).toBeDefined()
  })

  it('chaining withRules() layers rules', async () => {
    const db = new CodecDatabaseReader(createMockDbReader(tableData), tableMap)
    const secureDb = db
      .withRules({}, {
        users: { read: async (_ctx, doc) => (doc.role === 'admin' ? doc : null) },
      })
      .withRules({}, {
        users: { read: async (_ctx, doc) => ({ ...doc, name: doc.name.toUpperCase() }) },
      })
    const results = await secureDb.query('users' as any).collect()
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('ALICE')
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `bun test packages/zodvex/__tests__/rules.test.ts`
Expected: FAIL — `withRules` does not exist on `CodecDatabaseReader`

**Step 3: Implement RulesCodecDatabaseReader and add withRules() to CodecDatabaseReader**

Add to `packages/zodvex/src/rules.ts`:

```ts
import { CodecDatabaseReader, CodecQueryChain } from './db'
import type { ZodTableMap } from './schema'

class RulesCodecDatabaseReader<
  DataModel extends GenericDataModel,
  DecodedDocs extends Record<string, any>,
> extends CodecDatabaseReader<DataModel, DecodedDocs> {
  constructor(
    private inner: CodecDatabaseReader<DataModel, DecodedDocs>,
    private ctx: any,
    private rules: Record<string, TableRules<any, any>>,
    private rulesConfig: CodecRulesConfig,
  ) {
    // Pass the inner's protected fields to super.
    // We override all methods, so super's behavior is unused.
    super((inner as any).db, (inner as any).tableMap)
    this.system = inner.system
  }

  async get(idOrTable: any, maybeId?: any): Promise<any> {
    const doc = await this.inner.get(idOrTable, maybeId)
    if (doc === null) return null

    // Resolve table name for rule lookup
    const tableName = maybeId !== undefined
      ? (idOrTable as string)
      : this.resolveTableFromId(idOrTable)

    if (!tableName) return doc
    return this.applyReadRule(tableName, doc)
  }

  query<TableName extends TableNamesInDataModel<DataModel>>(
    tableName: TableName,
  ): any {
    const innerChain = this.inner.query(tableName)
    const tableRules = this.rules[tableName as string]
    if (!tableRules?.read) {
      // No read rule — check defaultPolicy
      if ((this.rulesConfig.defaultPolicy ?? 'allow') === 'deny') {
        // Table is listed but no read rule + deny policy — block all reads
        const denyRule: ReadRule<any, any> = async () => null
        return new RulesCodecQueryChain(innerChain as any, tableName as string, denyRule, this.rulesConfig, this.ctx)
      }
      return innerChain
    }
    return new RulesCodecQueryChain(
      innerChain as any,
      tableName as string,
      tableRules.read,
      this.rulesConfig,
      this.ctx,
    )
  }

  private resolveTableFromId(id: any): string | null {
    for (const tableName of Object.keys(this.rules)) {
      if (this.inner.normalizeId(tableName as any, id as unknown as string)) {
        return tableName
      }
    }
    return null
  }

  private async applyReadRule(tableName: string, doc: any): Promise<any> {
    const tableRules = this.rules[tableName]
    if (!tableRules?.read) {
      if ((this.rulesConfig.defaultPolicy ?? 'allow') === 'deny') return null
      return doc
    }
    return tableRules.read(this.ctx, doc)
  }
}
```

Add to `packages/zodvex/src/db.ts` — the `withRules()` method on `CodecDatabaseReader`:

```ts
import type { CodecRules, CodecRulesConfig } from './rules'
import { createRulesCodecDatabaseReader } from './rules'

// Inside CodecDatabaseReader class:
withRules<Ctx>(
  ctx: Ctx,
  rules: CodecRules<Ctx, DataModel, DecodedDocs>,
  config?: CodecRulesConfig,
): CodecDatabaseReader<DataModel, DecodedDocs> {
  return createRulesCodecDatabaseReader(this, ctx, rules, config)
}
```

Export a factory function from `rules.ts` (to avoid circular dependency — `db.ts` imports from `rules.ts`, `rules.ts` imports from `db.ts`):

```ts
export function createRulesCodecDatabaseReader<
  DataModel extends GenericDataModel,
  DecodedDocs extends Record<string, any>,
>(
  inner: CodecDatabaseReader<DataModel, DecodedDocs>,
  ctx: any,
  rules: Record<string, TableRules<any, any>>,
  config?: CodecRulesConfig,
): CodecDatabaseReader<DataModel, DecodedDocs> {
  return new RulesCodecDatabaseReader(inner, ctx, rules as any, config ?? {})
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test packages/zodvex/__tests__/rules.test.ts`
Expected: PASS (all tests)

**Step 5: Commit**

```bash
git add packages/zodvex/src/rules.ts packages/zodvex/src/db.ts packages/zodvex/__tests__/rules.test.ts
git commit -m "feat: add withRules() to CodecDatabaseReader with read rule filtering"
```

---

### Task 4: RulesCodecDatabaseWriter — Write-Side Rule Wrapping

**Files:**
- Modify: `packages/zodvex/src/rules.ts`
- Modify: `packages/zodvex/src/db.ts` (add `.withRules()` to Writer)
- Test: `packages/zodvex/__tests__/rules.test.ts`

**Step 1: Write failing tests for withRules() on writer**

Add to `packages/zodvex/__tests__/rules.test.ts`:

```ts
import { CodecDatabaseWriter } from '../src/db'

function createMockDbWriter(tables: Record<string, any[]>) {
  const calls: { method: string; args: any[] }[] = []
  const reader = createMockDbReader(tables)
  const mockDb: any = {
    ...reader,
    insert: async (table: string, value: any) => {
      calls.push({ method: 'insert', args: [table, value] })
      return `${table}:new`
    },
    patch: async (...args: any[]) => {
      calls.push({ method: 'patch', args })
    },
    replace: async (...args: any[]) => {
      calls.push({ method: 'replace', args })
    },
    delete: async (...args: any[]) => {
      calls.push({ method: 'delete', args })
    },
  }
  return { db: mockDb, calls }
}

describe('CodecDatabaseWriter.withRules()', () => {
  it('insert() calls insert rule and uses transformed value', async () => {
    const { db: mockDb, calls } = createMockDbWriter(tableData)
    const db = new CodecDatabaseWriter(mockDb, tableMap)
    const secureDb = db.withRules({}, {
      users: {
        insert: async (_ctx, value) => ({ ...value, injected: true }),
      },
    })
    await secureDb.insert('users' as any, {
      name: 'Charlie',
      createdAt: new Date(1700000000000),
      role: 'user',
    } as any)
    expect(calls).toHaveLength(1)
    // The insert rule transformed the value before encoding
    expect(calls[0].args[1].injected).toBe(true)
  })

  it('insert() throws when insert rule throws', async () => {
    const { db: mockDb } = createMockDbWriter(tableData)
    const db = new CodecDatabaseWriter(mockDb, tableMap)
    const secureDb = db.withRules({}, {
      users: {
        insert: async () => { throw new Error('insert denied') },
      },
    })
    await expect(
      secureDb.insert('users' as any, { name: 'X', createdAt: new Date(), role: 'user' } as any)
    ).rejects.toThrow('insert denied')
  })

  it('patch() calls patch rule with current doc and patch value', async () => {
    const { db: mockDb, calls } = createMockDbWriter(tableData)
    const db = new CodecDatabaseWriter(mockDb, tableMap)
    let receivedDoc: any
    let receivedValue: any
    const secureDb = db.withRules({}, {
      users: {
        read: async (_ctx, doc) => doc,
        patch: async (_ctx, doc, value) => {
          receivedDoc = doc
          receivedValue = value
          return value
        },
      },
    })
    await secureDb.patch('users:1' as any, { name: 'Alice Updated' } as any)
    expect(receivedDoc.name).toBe('Alice')
    expect(receivedDoc.createdAt).toBeInstanceOf(Date) // decoded doc
    expect(receivedValue.name).toBe('Alice Updated')
    expect(calls).toHaveLength(1)
  })

  it('patch() throws when doc not found (no read access)', async () => {
    const { db: mockDb } = createMockDbWriter(tableData)
    const db = new CodecDatabaseWriter(mockDb, tableMap)
    const secureDb = db.withRules({}, {
      users: { read: async () => null },
    })
    await expect(
      secureDb.patch('users:1' as any, { name: 'X' } as any)
    ).rejects.toThrow('no read access or doc does not exist')
  })

  it('patch() throws when patch rule throws', async () => {
    const { db: mockDb } = createMockDbWriter(tableData)
    const db = new CodecDatabaseWriter(mockDb, tableMap)
    const secureDb = db.withRules({}, {
      users: {
        read: async (_ctx, doc) => doc,
        patch: async () => { throw new Error('modify denied') },
      },
    })
    await expect(
      secureDb.patch('users:1' as any, { name: 'X' } as any)
    ).rejects.toThrow('modify denied')
  })

  it('delete() calls delete rule with current doc', async () => {
    const { db: mockDb, calls } = createMockDbWriter(tableData)
    const db = new CodecDatabaseWriter(mockDb, tableMap)
    let receivedDoc: any
    const secureDb = db.withRules({}, {
      users: {
        read: async (_ctx, doc) => doc,
        delete: async (_ctx, doc) => { receivedDoc = doc },
      },
    })
    await secureDb.delete('users:1' as any)
    expect(receivedDoc.name).toBe('Alice')
    expect(calls).toHaveLength(1)
  })

  it('delete() throws when delete rule throws', async () => {
    const { db: mockDb } = createMockDbWriter(tableData)
    const db = new CodecDatabaseWriter(mockDb, tableMap)
    const secureDb = db.withRules({}, {
      users: {
        read: async (_ctx, doc) => doc,
        delete: async () => { throw new Error('delete denied') },
      },
    })
    await expect(secureDb.delete('users:1' as any)).rejects.toThrow('delete denied')
  })

  it('replace() calls replace rule with current doc and replacement', async () => {
    const { db: mockDb, calls } = createMockDbWriter(tableData)
    const db = new CodecDatabaseWriter(mockDb, tableMap)
    const secureDb = db.withRules({}, {
      users: {
        read: async (_ctx, doc) => doc,
        replace: async (_ctx, _doc, value) => value,
      },
    })
    await secureDb.replace('users:1' as any, {
      name: 'Alice Replaced',
      createdAt: new Date(1700000000000),
      role: 'admin',
    } as any)
    expect(calls).toHaveLength(1)
  })

  it('defaultPolicy deny blocks operations without rules', async () => {
    const { db: mockDb } = createMockDbWriter(tableData)
    const db = new CodecDatabaseWriter(mockDb, tableMap)
    const secureDb = db.withRules({}, {
      users: { read: async (_ctx, doc) => doc },
    }, { defaultPolicy: 'deny' })
    await expect(
      secureDb.insert('users' as any, { name: 'X', createdAt: new Date(), role: 'user' } as any)
    ).rejects.toThrow('insert not allowed on users')
  })

  it('defaultPolicy allow passes operations without rules', async () => {
    const { db: mockDb, calls } = createMockDbWriter(tableData)
    const db = new CodecDatabaseWriter(mockDb, tableMap)
    const secureDb = db.withRules({}, {
      users: { read: async (_ctx, doc) => doc },
    }, { defaultPolicy: 'allow' })
    await secureDb.insert('users' as any, {
      name: 'Charlie',
      createdAt: new Date(1700000000000),
      role: 'user',
    } as any)
    expect(calls).toHaveLength(1)
  })

  it('read methods delegate through rules', async () => {
    const { db: mockDb } = createMockDbWriter(tableData)
    const db = new CodecDatabaseWriter(mockDb, tableMap)
    const secureDb = db.withRules({}, {
      users: { read: async (_ctx, doc) => (doc.role === 'admin' ? doc : null) },
    })
    const results = await secureDb.query('users' as any).collect()
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('Alice')
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `bun test packages/zodvex/__tests__/rules.test.ts`
Expected: FAIL — `withRules` does not exist on `CodecDatabaseWriter`

**Step 3: Implement RulesCodecDatabaseWriter and add withRules() to CodecDatabaseWriter**

Add `RulesCodecDatabaseWriter` to `packages/zodvex/src/rules.ts` and `withRules()` to `CodecDatabaseWriter` in `packages/zodvex/src/db.ts`. Follow the same subclass pattern as the reader. The writer's read methods delegate to an internal `RulesCodecDatabaseReader`. Write methods fetch the current doc via `this.get()`, apply the operation-specific rule, then delegate to `super` with the (possibly transformed) value.

**Step 4: Run tests to verify they pass**

Run: `bun test packages/zodvex/__tests__/rules.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/zodvex/src/rules.ts packages/zodvex/src/db.ts packages/zodvex/__tests__/rules.test.ts
git commit -m "feat: add withRules() to CodecDatabaseWriter with per-operation rules"
```

---

### Task 5: Audit — afterRead and afterWrite Callbacks

**Files:**
- Modify: `packages/zodvex/src/rules.ts`
- Modify: `packages/zodvex/src/db.ts` (add `.audit()` method)
- Test: `packages/zodvex/__tests__/rules.test.ts`

**Step 1: Write failing tests for .audit()**

Add to `packages/zodvex/__tests__/rules.test.ts`:

```ts
describe('CodecDatabaseReader.audit()', () => {
  it('afterRead fires for each doc returned by get()', async () => {
    const auditLog: any[] = []
    const db = new CodecDatabaseReader(createMockDbReader(tableData), tableMap)
    const auditedDb = db.audit({
      afterRead: (table, doc) => { auditLog.push({ table, doc }) },
    })
    await auditedDb.get('users:1' as any)
    expect(auditLog).toHaveLength(1)
    expect(auditLog[0].table).toBe('users')
    expect(auditLog[0].doc.name).toBe('Alice')
  })

  it('afterRead does not fire when get() returns null', async () => {
    const auditLog: any[] = []
    const db = new CodecDatabaseReader(createMockDbReader(tableData), tableMap)
    const auditedDb = db.audit({
      afterRead: (table, doc) => { auditLog.push({ table, doc }) },
    })
    await auditedDb.get('users:missing' as any)
    expect(auditLog).toHaveLength(0)
  })

  it('afterRead fires for each doc from query().collect()', async () => {
    const auditLog: any[] = []
    const db = new CodecDatabaseReader(createMockDbReader(tableData), tableMap)
    const auditedDb = db.audit({
      afterRead: (table, doc) => { auditLog.push({ table, doc }) },
    })
    await auditedDb.query('users' as any).collect()
    expect(auditLog).toHaveLength(2)
  })

  it('composes with withRules() — audit sees rules-processed docs', async () => {
    const auditLog: any[] = []
    const db = new CodecDatabaseReader(createMockDbReader(tableData), tableMap)
    const secureDb = db
      .withRules({}, {
        users: { read: async (_ctx, doc) => (doc.role === 'admin' ? doc : null) },
      })
      .audit({
        afterRead: (table, doc) => { auditLog.push({ table, doc }) },
      })
    await secureDb.query('users' as any).collect()
    // Only Alice passes the rule, so audit sees only 1 doc
    expect(auditLog).toHaveLength(1)
    expect(auditLog[0].doc.name).toBe('Alice')
  })
})

describe('CodecDatabaseWriter.audit()', () => {
  it('afterWrite fires after successful insert', async () => {
    const auditLog: any[] = []
    const { db: mockDb } = createMockDbWriter(tableData)
    const db = new CodecDatabaseWriter(mockDb, tableMap)
    const auditedDb = db.audit({
      afterWrite: (table, event) => { auditLog.push({ table, event }) },
    })
    await auditedDb.insert('users' as any, {
      name: 'Charlie',
      createdAt: new Date(1700000000000),
      role: 'user',
    } as any)
    expect(auditLog).toHaveLength(1)
    expect(auditLog[0].table).toBe('users')
    expect(auditLog[0].event.type).toBe('insert')
    expect(auditLog[0].event.id).toBe('users:new')
  })

  it('afterWrite fires after successful patch', async () => {
    const auditLog: any[] = []
    const { db: mockDb } = createMockDbWriter(tableData)
    const db = new CodecDatabaseWriter(mockDb, tableMap)
    const auditedDb = db.audit({
      afterWrite: (table, event) => { auditLog.push({ table, event }) },
    })
    await auditedDb.patch('users:1' as any, { name: 'Updated' } as any)
    expect(auditLog).toHaveLength(1)
    expect(auditLog[0].event.type).toBe('patch')
  })

  it('afterWrite fires after successful delete', async () => {
    const auditLog: any[] = []
    const { db: mockDb } = createMockDbWriter(tableData)
    const db = new CodecDatabaseWriter(mockDb, tableMap)
    const auditedDb = db.audit({
      afterWrite: (table, event) => { auditLog.push({ table, event }) },
    })
    await auditedDb.delete('users:1' as any)
    expect(auditLog).toHaveLength(1)
    expect(auditLog[0].event.type).toBe('delete')
  })

  it('afterRead fires on writer read methods', async () => {
    const auditLog: any[] = []
    const { db: mockDb } = createMockDbWriter(tableData)
    const db = new CodecDatabaseWriter(mockDb, tableMap)
    const auditedDb = db.audit({
      afterRead: (table, doc) => { auditLog.push({ table, doc }) },
    })
    await auditedDb.get('users:1' as any)
    expect(auditLog).toHaveLength(1)
  })

  it('composes with withRules() — audit sees post-rule state', async () => {
    const auditLog: any[] = []
    const { db: mockDb, calls } = createMockDbWriter(tableData)
    const db = new CodecDatabaseWriter(mockDb, tableMap)
    const secureDb = db
      .withRules({}, {
        users: {
          read: async (_ctx, doc) => doc,
          insert: async (_ctx, value) => ({ ...value, injected: true }),
        },
      })
      .audit({
        afterWrite: (table, event) => { auditLog.push({ table, event }) },
      })
    await secureDb.insert('users' as any, {
      name: 'Charlie',
      createdAt: new Date(1700000000000),
      role: 'user',
    } as any)
    expect(auditLog).toHaveLength(1)
    expect(auditLog[0].event.value.injected).toBe(true)
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `bun test packages/zodvex/__tests__/rules.test.ts`
Expected: FAIL — `audit` does not exist

**Step 3: Implement AuditCodecDatabaseReader, AuditCodecDatabaseWriter, AuditCodecQueryChain**

Add to `packages/zodvex/src/rules.ts` and add `.audit()` methods to both classes in `packages/zodvex/src/db.ts`. The audit subclasses override terminal methods to fire the callback after the operation completes. `AuditCodecQueryChain` wraps `CodecQueryChain` and fires `afterRead` per doc at terminals.

**Step 4: Run tests to verify they pass**

Run: `bun test packages/zodvex/__tests__/rules.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/zodvex/src/rules.ts packages/zodvex/src/db.ts packages/zodvex/__tests__/rules.test.ts
git commit -m "feat: add audit() to CodecDatabaseReader/Writer with afterRead/afterWrite"
```

---

### Task 6: Exports and Build Verification

**Files:**
- Modify: `packages/zodvex/src/server/index.ts` (add type exports)
- Modify: `packages/zodvex/src/core/index.ts` (add type exports if needed)

**Step 1: Add exports to server entry point**

Add to `packages/zodvex/src/server/index.ts`:

```ts
export type {
  CodecRules,
  CodecRulesConfig,
  TableRules,
  WriteEvent,
  ReaderAuditConfig,
  WriterAuditConfig,
  ReadRule,
  InsertRule,
  PatchRule,
  ReplaceRule,
  DeleteRule,
} from '../rules'
```

**Step 2: Build the library**

Run: `bun run build`
Expected: Clean build, no errors

**Step 3: Run type-check**

Run: `bun run type-check`
Expected: No TypeScript errors

**Step 4: Run full test suite**

Run: `bun test`
Expected: All tests pass (existing + new)

**Step 5: Run linter**

Run: `bun run lint`
Expected: Clean (or fix any issues with `bun run lint:fix`)

**Step 6: Commit**

```bash
git add packages/zodvex/src/server/index.ts
git commit -m "feat: export rule and audit types from zodvex/server"
```

---

### Task 7: Edge Cases and Hardening

**Files:**
- Test: `packages/zodvex/__tests__/rules.test.ts`

**Step 1: Write edge case tests**

Add to `packages/zodvex/__tests__/rules.test.ts`:

```ts
describe('edge cases', () => {
  it('withRules on table not in rules object — no rules applied', async () => {
    const extendedData = {
      ...tableData,
      logs: [{ _id: 'logs:1', _creationTime: 100, message: 'hello' }],
    }
    const db = new CodecDatabaseReader(
      createMockDbReader(extendedData),
      { ...tableMap },
    )
    const secureDb = db.withRules({}, {
      users: { read: async () => null }, // deny all users
    }, { defaultPolicy: 'deny' })
    // logs table is not listed in rules — should pass through unchanged
    const logResults = await secureDb.query('logs' as any).collect()
    expect(logResults).toHaveLength(1)
  })

  it('defaultPolicy deny only affects listed tables', async () => {
    const db = new CodecDatabaseReader(createMockDbReader(tableData), tableMap)
    const secureDb = db.withRules({}, {
      users: {}, // listed but no read rule
    }, { defaultPolicy: 'deny' })
    const user = await secureDb.get('users:1' as any)
    expect(user).toBeNull()
  })

  it('patch rule receives decoded doc (not wire)', async () => {
    const { db: mockDb } = createMockDbWriter(tableData)
    const db = new CodecDatabaseWriter(mockDb, tableMap)
    let docCreatedAt: any
    const secureDb = db.withRules({}, {
      users: {
        read: async (_ctx, doc) => doc,
        patch: async (_ctx, doc, value) => {
          docCreatedAt = doc.createdAt
          return value
        },
      },
    })
    await secureDb.patch('users:1' as any, { name: 'Updated' } as any)
    expect(docCreatedAt).toBeInstanceOf(Date)
  })

  it('audit afterWrite receives pre-encode value', async () => {
    const auditLog: any[] = []
    const { db: mockDb } = createMockDbWriter(tableData)
    const db = new CodecDatabaseWriter(mockDb, tableMap)
    const auditedDb = db.audit({
      afterWrite: (_table, event) => { auditLog.push(event) },
    })
    await auditedDb.insert('users' as any, {
      name: 'Charlie',
      createdAt: new Date(1700000000000),
      role: 'user',
    } as any)
    // The audit event should contain the runtime value (Date), not wire (number)
    expect(auditLog[0].value.createdAt).toBeInstanceOf(Date)
  })
})
```

**Step 2: Run tests**

Run: `bun test packages/zodvex/__tests__/rules.test.ts`
Expected: PASS (or fix implementation if any fail)

**Step 3: Commit**

```bash
git add packages/zodvex/__tests__/rules.test.ts
git commit -m "test: add edge case tests for rules and audit"
```

---

### Task 8: Final Verification

**Step 1: Run full test suite**

Run: `bun test`
Expected: All tests pass

**Step 2: Build and type-check**

Run: `bun run build && bun run type-check`
Expected: Clean

**Step 3: Lint**

Run: `bun run lint:fix && bun run lint`
Expected: Clean

**Step 4: Commit any lint fixes**

```bash
git add -A && git commit -m "chore: lint and format fixes"
```
