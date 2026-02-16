# Codec-Aware DB Infrastructure Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the codec-aware database infrastructure from the [finalized design](./2026-02-15-codec-db-infrastructure-design.md) — `defineZodSchema`, `initZodvex`, DB wrapper, hooks, and the `example/` validation project.

**Architecture:** zodvex wraps Convex's `ctx.db` with a codec-aware class that auto-decodes reads and auto-encodes writes. `initZodvex(schema, server)` returns pre-configured builders; `.withContext()` / `.withHooks()` enable layered composition. The `example/` project exercises every feature and serves as an integration test.

**Tech Stack:** TypeScript, Zod v4, Convex, convex-helpers, Bun test runner

---

### Task 1: `zodTable().name` enhancement

**Files:**
- Modify: `src/tables.ts`
- Test: `__tests__/tables-schema.test.ts`

**Step 1: Write the failing test**

Add to `__tests__/tables-schema.test.ts` inside the `object shapes` describe block:

```typescript
it('exposes the table name via .name property', () => {
  const Users = zodTable('users', { name: z.string() })
  expect(Users.name).toBe('users')
})
```

Add a union variant test in the `union schemas` describe block:

```typescript
it('exposes the table name via .name property (unions)', () => {
  const Shapes = zodTable(
    'shapes',
    z.union([
      z.object({ kind: z.literal('circle'), r: z.number() }),
      z.object({ kind: z.literal('rect'), w: z.number() })
    ])
  )
  expect(Shapes.name).toBe('shapes')
})
```

**Step 2: Run test to verify it fails**

Run: `bun test __tests__/tables-schema.test.ts`
Expected: FAIL — `undefined` is not `'users'`

**Step 3: Write minimal implementation**

In `src/tables.ts`, object-shape path (~line 539), add `name` to the Object.assign:

```typescript
return Object.assign(table, {
  name,  // <-- ADD THIS
  shape,
  schema,
  zDoc,
  docArray
})
```

In union/schema path (~line 610), add `name` to the return:

```typescript
return {
  name,  // <-- ADD THIS
  table,
  tableName: name,
  // ... rest stays same
}
```

Update both overload return types (overload 1, 2, and 3) to include:
```typescript
name: TableName
```

**Step 4: Run test to verify it passes**

Run: `bun test __tests__/tables-schema.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/tables.ts __tests__/tables-schema.test.ts
git commit -m "feat: add .name property to zodTable return value"
```

---

### Task 2: `defineZodSchema()`

**Files:**
- Create: `src/schema.ts`
- Modify: `src/server/index.ts`
- Test: `__tests__/schema.test.ts`

**Step 1: Write the failing test**

Create `__tests__/schema.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { zodTable } from '../src/tables'
import { defineZodSchema } from '../src/schema'

describe('defineZodSchema', () => {
  const Users = zodTable('users', {
    name: z.string(),
    email: z.string(),
  })

  const Events = zodTable('events', {
    title: z.string(),
    date: z.number(),
  })

  it('returns an object with .zodTables preserving the input', () => {
    const schema = defineZodSchema({ users: Users, events: Events })
    expect(schema.zodTables.users).toBe(Users)
    expect(schema.zodTables.events).toBe(Events)
  })

  it('returns an object with .tables containing Convex table defs', () => {
    const schema = defineZodSchema({ users: Users, events: Events })
    // .tables is the raw Convex schema definition result
    expect(schema.tables).toBeDefined()
    expect(schema.tables.users).toBeDefined()
    expect(schema.tables.events).toBeDefined()
  })

  it('preserves table names from zodTable', () => {
    const schema = defineZodSchema({ users: Users, events: Events })
    expect(Object.keys(schema.zodTables)).toEqual(['users', 'events'])
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test __tests__/schema.test.ts`
Expected: FAIL — cannot import `defineZodSchema`

**Step 3: Write minimal implementation**

Create `src/schema.ts`:

```typescript
import { defineSchema } from 'convex/server'

/**
 * Wraps Convex's defineSchema() to capture zodTable references.
 * Returns a valid Convex schema definition plus .zodTables for zodvex.
 *
 * @param tables - Object mapping table names to zodTable definitions
 * @returns Convex schema + zodTable metadata
 */
export function defineZodSchema<
  T extends Record<string, { table: any; name: string; schema: any }>
>(tables: T) {
  // Extract .table from each zodTable for Convex's defineSchema
  const convexTables: Record<string, any> = {}
  for (const [name, zodTableDef] of Object.entries(tables)) {
    convexTables[name] = zodTableDef.table
  }

  return {
    tables: convexTables,
    zodTables: tables,
  }
}
```

Add to `src/server/index.ts`:

```typescript
export * from '../schema'
```

**Step 4: Run test to verify it passes**

Run: `bun test __tests__/schema.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/schema.ts src/server/index.ts __tests__/schema.test.ts
git commit -m "feat: add defineZodSchema for capturing zodTable refs"
```

---

### Task 3: `decodeDoc()` / `encodeDoc()` primitives

**Files:**
- Create: `src/db/primitives.ts`
- Create: `src/db/index.ts`
- Modify: `src/server/index.ts`
- Test: `__tests__/db/primitives.test.ts`

**Step 1: Write the failing test**

Create `__tests__/db/primitives.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { zx } from '../src/zx'
import { zodTable } from '../src/tables'
import { decodeDoc, encodeDoc } from '../src/db/primitives'

describe('decodeDoc', () => {
  it('decodes a wire-format document using zodTable schema', () => {
    const Events = zodTable('events', {
      title: z.string(),
      startDate: zx.date(),
    })

    const wire = {
      _id: 'events:123' as any,
      _creationTime: 1000,
      title: 'Meeting',
      startDate: 1700000000000,
    }

    const decoded = decodeDoc(Events.schema.doc, wire)
    expect(decoded.title).toBe('Meeting')
    expect(decoded.startDate).toBeInstanceOf(Date)
    expect(decoded.startDate.getTime()).toBe(1700000000000)
  })

  it('returns null passthrough for null input', () => {
    const Users = zodTable('users', { name: z.string() })
    const result = decodeDoc(Users.schema.doc.nullable(), null)
    expect(result).toBeNull()
  })
})

describe('encodeDoc', () => {
  it('encodes a runtime document to wire format', () => {
    const Events = zodTable('events', {
      title: z.string(),
      startDate: zx.date(),
    })

    const runtime = {
      _id: 'events:123' as any,
      _creationTime: 1000,
      title: 'Meeting',
      startDate: new Date(1700000000000),
    }

    const encoded = encodeDoc(Events.schema.doc, runtime)
    expect(encoded.title).toBe('Meeting')
    expect(encoded.startDate).toBe(1700000000000)
    expect(typeof encoded.startDate).toBe('number')
  })

  it('strips undefined values from encoded output', () => {
    const Users = zodTable('users', {
      name: z.string(),
      bio: z.string().optional(),
    })

    const runtime = {
      _id: 'users:1' as any,
      _creationTime: 1000,
      name: 'John',
      bio: undefined,
    }

    const encoded = encodeDoc(Users.schema.doc, runtime)
    expect('bio' in encoded).toBe(false)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test __tests__/db/primitives.test.ts`
Expected: FAIL — cannot resolve `../src/db/primitives`

**Step 3: Write minimal implementation**

Create `src/db/primitives.ts`:

```typescript
import { z } from 'zod'
import { stripUndefined } from '../utils'

/**
 * Decode a wire-format document to runtime format using a Zod schema.
 * Applies codec transforms (e.g., timestamp → Date via zx.date()).
 *
 * @param schema - The Zod schema (typically zodTable.schema.doc)
 * @param raw - Wire-format document from Convex
 * @returns Decoded runtime-format document
 */
export function decodeDoc<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  return schema.parse(raw)
}

/**
 * Encode a runtime-format document to wire format using a Zod schema.
 * Applies codec transforms (e.g., Date → timestamp via zx.date()).
 * Strips undefined values (Convex rejects explicit undefined).
 *
 * @param schema - The Zod schema (typically zodTable.schema.doc)
 * @param value - Runtime-format document
 * @returns Wire-format document for Convex storage
 */
export function encodeDoc<S extends z.ZodType>(schema: S, value: z.output<S>): z.input<S> {
  return stripUndefined(z.encode(schema, value))
}
```

Create `src/db/index.ts`:

```typescript
export * from './primitives'
```

Add to `src/server/index.ts`:

```typescript
export * from '../db'
```

**Step 4: Run test to verify it passes**

Run: `bun test __tests__/db/primitives.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/db/primitives.ts src/db/index.ts src/server/index.ts __tests__/db/primitives.test.ts
git commit -m "feat: add decodeDoc/encodeDoc primitives"
```

---

### Task 4: `createDatabaseHooks()` / `composeHooks()`

**Files:**
- Create: `src/db/hooks.ts`
- Modify: `src/db/index.ts`
- Test: `__tests__/db/hooks.test.ts`

**Step 1: Write the failing test**

Create `__tests__/db/hooks.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test'
import { createDatabaseHooks, composeHooks } from '../src/db/hooks'

describe('createDatabaseHooks', () => {
  it('returns the hook config as-is (type-level factory)', () => {
    const hooks = createDatabaseHooks<{ user: string }>({
      decode: {
        before: {
          one: async (ctx, doc) => {
            return doc
          },
        },
      },
    })

    expect(hooks.decode?.before?.one).toBeDefined()
  })

  it('supports encode hooks', () => {
    const hooks = createDatabaseHooks<{ user: string }>({
      encode: {
        before: async (ctx, doc) => doc,
        after: async (ctx, doc) => doc,
      },
    })

    expect(hooks.encode?.before).toBeDefined()
    expect(hooks.encode?.after).toBeDefined()
  })
})

describe('composeHooks', () => {
  it('composes decode.before.one hooks in order', async () => {
    const log: string[] = []

    const hookA = createDatabaseHooks<{}>({
      decode: {
        before: {
          one: async (ctx, doc) => {
            log.push('A')
            return { ...doc, a: true }
          },
        },
      },
    })

    const hookB = createDatabaseHooks<{}>({
      decode: {
        before: {
          one: async (ctx, doc) => {
            log.push('B')
            return { ...doc, b: true }
          },
        },
      },
    })

    const composed = composeHooks([hookA, hookB])
    const result = await composed.decode!.before!.one!({} as any, { original: true } as any)

    expect(log).toEqual(['A', 'B'])
    expect(result).toEqual({ original: true, a: true, b: true })
  })

  it('short-circuits decode.before.one when a hook returns null', async () => {
    const log: string[] = []

    const hookA = createDatabaseHooks<{}>({
      decode: {
        before: {
          one: async (_ctx, _doc) => {
            log.push('A')
            return null  // deny
          },
        },
      },
    })

    const hookB = createDatabaseHooks<{}>({
      decode: {
        before: {
          one: async (_ctx, _doc) => {
            log.push('B')
            return _doc
          },
        },
      },
    })

    const composed = composeHooks([hookA, hookB])
    const result = await composed.decode!.before!.one!({} as any, { data: true } as any)

    expect(log).toEqual(['A'])  // B never called
    expect(result).toBeNull()
  })

  it('composes decode.before.many with piped one', async () => {
    const hookA = createDatabaseHooks<{}>({
      decode: {
        before: {
          many: async (ctx, docs, one) => {
            // Use the bound one to filter
            const results = []
            for (const doc of docs) {
              const result = await one(doc)
              if (result) results.push(result)
            }
            return results
          },
        },
      },
    })

    const hookB = createDatabaseHooks<{}>({
      decode: {
        before: {
          one: async (ctx, doc: any) => {
            return doc.keep ? doc : null
          },
        },
      },
    })

    const composed = composeHooks([hookA, hookB])
    const docs = [
      { keep: true, id: 1 },
      { keep: false, id: 2 },
      { keep: true, id: 3 },
    ]

    // Default one for hookA is identity, hookB's one filters
    const result = await composed.decode!.before!.many!(
      {} as any,
      docs as any,
      async (doc: any) => doc  // base one
    )

    expect(result).toHaveLength(2)
  })

  it('composes encode.before hooks in order', async () => {
    const log: string[] = []

    const hookA = createDatabaseHooks<{}>({
      encode: {
        before: async (ctx, doc) => {
          log.push('A')
          return { ...doc, a: true }
        },
      },
    })

    const hookB = createDatabaseHooks<{}>({
      encode: {
        before: async (ctx, doc) => {
          log.push('B')
          return { ...doc, b: true }
        },
      },
    })

    const composed = composeHooks([hookA, hookB])
    const result = await composed.encode!.before!({} as any, { original: true } as any)

    expect(log).toEqual(['A', 'B'])
    expect(result).toEqual({ original: true, a: true, b: true })
  })

  it('returns empty hooks when composing empty array', () => {
    const composed = composeHooks([])
    expect(composed).toEqual({})
  })

  it('returns single hooks as-is when array has one element', () => {
    const hooks = createDatabaseHooks<{}>({
      decode: {
        after: {
          one: async (ctx, doc) => doc,
        },
      },
    })

    const composed = composeHooks([hooks])
    expect(composed.decode?.after?.one).toBe(hooks.decode?.after?.one)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test __tests__/db/hooks.test.ts`
Expected: FAIL — cannot import from `../src/db/hooks`

**Step 3: Write minimal implementation**

Create `src/db/hooks.ts`:

```typescript
/**
 * Database hook types and composition utilities.
 *
 * Hooks intercept DB operations for transforms, security, logging.
 * Grouped: operation-first (decode/encode) → timing (before/after) → cardinality (one/many).
 */

// ============================================================================
// Hook Context Types
// ============================================================================

export interface SingleDocContext {
  table: string
  operation: 'get' | 'first' | 'unique'
}

export interface MultiDocContext {
  table: string
  operation: 'collect' | 'take' | 'paginate'
}

export interface InsertContext {
  table: string
  operation: 'insert'
}

export interface PatchContext {
  table: string
  operation: 'patch'
  existingDoc: Record<string, unknown>
}

export interface DeleteContext {
  table: string
  operation: 'delete'
  existingDoc: Record<string, unknown>
}

export type WriteContext = InsertContext | PatchContext | DeleteContext
export type ReadContext = SingleDocContext | MultiDocContext

// ============================================================================
// Hook Types
// ============================================================================

type WireDoc = Record<string, unknown>
type RuntimeDoc = Record<string, unknown>

export type DecodeHooks<Ctx> = {
  before?: {
    one?: (ctx: Ctx & ReadContext, doc: WireDoc) => Promise<WireDoc | null> | WireDoc | null
    many?: (
      ctx: Ctx & ReadContext,
      docs: WireDoc[],
      one: (doc: WireDoc) => Promise<WireDoc | null>
    ) => Promise<WireDoc[]> | WireDoc[]
  }
  after?: {
    one?: (ctx: Ctx & ReadContext, doc: RuntimeDoc) => Promise<RuntimeDoc | null> | RuntimeDoc | null
    many?: (
      ctx: Ctx & ReadContext,
      docs: RuntimeDoc[],
      one: (doc: RuntimeDoc) => Promise<RuntimeDoc | null>
    ) => Promise<RuntimeDoc[]> | RuntimeDoc[]
  }
}

export type EncodeHooks<Ctx> = {
  before?: (ctx: Ctx & WriteContext, doc: RuntimeDoc) => Promise<RuntimeDoc | null> | RuntimeDoc | null
  after?: (ctx: Ctx & WriteContext, doc: WireDoc) => Promise<WireDoc | null> | WireDoc | null
}

export type DatabaseHooks<Ctx = any> = {
  decode?: DecodeHooks<Ctx>
  encode?: EncodeHooks<Ctx>
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Creates a typed hook configuration.
 * Mostly a type-level helper — returns the config as-is but ensures
 * the Ctx generic flows to all hook callbacks.
 */
export function createDatabaseHooks<Ctx>(config: DatabaseHooks<Ctx>): DatabaseHooks<Ctx> {
  return config
}

// ============================================================================
// Composition
// ============================================================================

/**
 * Composes multiple hook configs into a single config.
 * At each stage, hook A's result feeds into hook B.
 * For decode.before.one, null short-circuits (subsequent hooks skipped).
 */
export function composeHooks<Ctx>(hooks: DatabaseHooks<Ctx>[]): DatabaseHooks<Ctx> {
  if (hooks.length === 0) return {}
  if (hooks.length === 1) return hooks[0]

  return {
    decode: composeDecodeHooks(hooks),
    encode: composeEncodeHooks(hooks),
  }
}

function composeDecodeHooks<Ctx>(hooks: DatabaseHooks<Ctx>[]): DecodeHooks<Ctx> | undefined {
  const befores = hooks.map(h => h.decode?.before).filter(Boolean)
  const afters = hooks.map(h => h.decode?.after).filter(Boolean)

  if (befores.length === 0 && afters.length === 0) return undefined

  return {
    before: befores.length > 0 ? composeBeforeHooks(befores as NonNullable<DecodeHooks<Ctx>['before']>[]) : undefined,
    after: afters.length > 0 ? composeAfterHooks(afters as NonNullable<DecodeHooks<Ctx>['after']>[]) : undefined,
  }
}

function composeBeforeHooks<Ctx>(stages: NonNullable<DecodeHooks<Ctx>['before']>[]): DecodeHooks<Ctx>['before'] {
  const ones = stages.map(s => s.one).filter(Boolean) as NonNullable<DecodeHooks<Ctx>['before']>['one'][]
  const manys = stages.map(s => s.many).filter(Boolean) as NonNullable<DecodeHooks<Ctx>['before']>['many'][]

  return {
    one: ones.length > 0
      ? async (ctx: any, doc: WireDoc) => {
          let current: WireDoc | null = doc
          for (const one of ones) {
            if (current === null) return null
            current = await one!(ctx, current)
          }
          return current
        }
      : undefined,
    many: manys.length > 0 || ones.length > 0
      ? async (ctx: any, docs: WireDoc[], baseOne: (doc: WireDoc) => Promise<WireDoc | null>) => {
          // Build composed one from all stages' one hooks
          const composedOne = async (doc: WireDoc): Promise<WireDoc | null> => {
            let current: WireDoc | null = doc
            for (const one of ones) {
              if (current === null) return null
              current = await one!(ctx, current)
            }
            return current
          }

          // If there are many hooks, pipe through them
          if (manys.length > 0) {
            let currentDocs = docs
            for (const many of manys) {
              currentDocs = await many!(ctx, currentDocs, composedOne)
            }
            return currentDocs
          }

          // Default many: map composedOne over docs
          const results: WireDoc[] = []
          for (const doc of docs) {
            const result = await composedOne(doc)
            if (result !== null) results.push(result)
          }
          return results
        }
      : undefined,
  }
}

function composeAfterHooks<Ctx>(stages: NonNullable<DecodeHooks<Ctx>['after']>[]): DecodeHooks<Ctx>['after'] {
  const ones = stages.map(s => s.one).filter(Boolean) as NonNullable<DecodeHooks<Ctx>['after']>['one'][]
  const manys = stages.map(s => s.many).filter(Boolean) as NonNullable<DecodeHooks<Ctx>['after']>['many'][]

  return {
    one: ones.length > 0
      ? async (ctx: any, doc: RuntimeDoc) => {
          let current: RuntimeDoc | null = doc
          for (const one of ones) {
            if (current === null) return null
            current = await one!(ctx, current)
          }
          return current
        }
      : undefined,
    many: manys.length > 0 || ones.length > 0
      ? async (ctx: any, docs: RuntimeDoc[], baseOne: (doc: RuntimeDoc) => Promise<RuntimeDoc | null>) => {
          const composedOne = async (doc: RuntimeDoc): Promise<RuntimeDoc | null> => {
            let current: RuntimeDoc | null = doc
            for (const one of ones) {
              if (current === null) return null
              current = await one!(ctx, current)
            }
            return current
          }

          if (manys.length > 0) {
            let currentDocs = docs
            for (const many of manys) {
              currentDocs = await many!(ctx, currentDocs, composedOne)
            }
            return currentDocs
          }

          const results: RuntimeDoc[] = []
          for (const doc of docs) {
            const result = await composedOne(doc)
            if (result !== null) results.push(result)
          }
          return results
        }
      : undefined,
  }
}

function composeEncodeHooks<Ctx>(hooks: DatabaseHooks<Ctx>[]): EncodeHooks<Ctx> | undefined {
  const befores = hooks.map(h => h.encode?.before).filter(Boolean) as NonNullable<EncodeHooks<Ctx>['before']>[]
  const afters = hooks.map(h => h.encode?.after).filter(Boolean) as NonNullable<EncodeHooks<Ctx>['after']>[]

  if (befores.length === 0 && afters.length === 0) return undefined

  return {
    before: befores.length > 0
      ? async (ctx: any, doc: RuntimeDoc) => {
          let current: RuntimeDoc | null = doc
          for (const fn of befores) {
            if (current === null) return null
            current = await fn(ctx, current)
          }
          return current
        }
      : undefined,
    after: afters.length > 0
      ? async (ctx: any, doc: WireDoc) => {
          let current: WireDoc | null = doc
          for (const fn of afters) {
            if (current === null) return null
            current = await fn(ctx, current)
          }
          return current
        }
      : undefined,
  }
}
```

Update `src/db/index.ts`:

```typescript
export * from './primitives'
export * from './hooks'
```

**Step 4: Run test to verify it passes**

Run: `bun test __tests__/db/hooks.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/db/hooks.ts src/db/index.ts __tests__/db/hooks.test.ts
git commit -m "feat: add createDatabaseHooks and composeHooks"
```

---

### Task 5: Codec-aware DB wrapper — Reader

**Files:**
- Create: `src/db/wrapper.ts`
- Modify: `src/db/index.ts`
- Test: `__tests__/db/wrapper-reader.test.ts`

**Step 1: Write the failing test**

Create `__tests__/db/wrapper-reader.test.ts`:

```typescript
import { describe, expect, it, mock } from 'bun:test'
import { z } from 'zod'
import { zx } from '../src/zx'
import { zodTable } from '../src/tables'
import { createZodDbReader } from '../src/db/wrapper'

// Mock zodTables lookup
const Events = zodTable('events', {
  title: z.string(),
  startDate: zx.date(),
})

const zodTables = {
  events: Events,
}

// Minimal mock of Convex db reader
function mockDbReader(data: Record<string, Record<string, any>>) {
  return {
    get: async (id: string) => data[id] ?? null,
    query: (table: string) => {
      const tableData = Object.values(data).filter((d: any) => d._table === table)
      return {
        withIndex: () => ({
          collect: async () => tableData,
          first: async () => tableData[0] ?? null,
          unique: async () => tableData.length === 1 ? tableData[0] : null,
          take: async (n: number) => tableData.slice(0, n),
          order: function() { return this },
          filter: function() { return this },
        }),
        collect: async () => tableData,
        first: async () => tableData[0] ?? null,
        unique: async () => tableData.length === 1 ? tableData[0] : null,
        take: async (n: number) => tableData.slice(0, n),
        order: function() { return this },
        filter: function() { return this },
      }
    },
  }
}

describe('createZodDbReader', () => {
  it('decodes documents from db.get()', async () => {
    const db = mockDbReader({
      'events:1': {
        _id: 'events:1',
        _creationTime: 1000,
        _table: 'events',
        title: 'Meeting',
        startDate: 1700000000000,
      },
    })

    const zodDb = createZodDbReader(db as any, zodTables)
    const event = await zodDb.get('events:1' as any)

    expect(event).not.toBeNull()
    expect(event!.title).toBe('Meeting')
    expect(event!.startDate).toBeInstanceOf(Date)
    expect(event!.startDate.getTime()).toBe(1700000000000)
  })

  it('returns null from db.get() when document not found', async () => {
    const db = mockDbReader({})
    const zodDb = createZodDbReader(db as any, zodTables)
    const result = await zodDb.get('events:999' as any)
    expect(result).toBeNull()
  })

  it('decodes documents from query().collect()', async () => {
    const db = mockDbReader({
      'events:1': {
        _id: 'events:1',
        _creationTime: 1000,
        _table: 'events',
        title: 'Meeting',
        startDate: 1700000000000,
      },
    })

    const zodDb = createZodDbReader(db as any, zodTables)
    const events = await zodDb.query('events').collect()

    expect(events).toHaveLength(1)
    expect(events[0].startDate).toBeInstanceOf(Date)
  })

  it('decodes documents from query().first()', async () => {
    const db = mockDbReader({
      'events:1': {
        _id: 'events:1',
        _creationTime: 1000,
        _table: 'events',
        title: 'First',
        startDate: 1700000000000,
      },
    })

    const zodDb = createZodDbReader(db as any, zodTables)
    const event = await zodDb.query('events').first()

    expect(event).not.toBeNull()
    expect(event!.startDate).toBeInstanceOf(Date)
  })

  it('returns null from query().first() when no results', async () => {
    const db = mockDbReader({})
    const zodDb = createZodDbReader(db as any, zodTables)
    const result = await zodDb.query('events').first()
    expect(result).toBeNull()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test __tests__/db/wrapper-reader.test.ts`
Expected: FAIL — cannot import `createZodDbReader`

**Step 3: Write minimal implementation**

Create `src/db/wrapper.ts`:

```typescript
import { z } from 'zod'
import { decodeDoc } from './primitives'
import type { DatabaseHooks, ReadContext } from './hooks'

type ZodTables = Record<string, { name: string; schema: { doc: z.ZodTypeAny } }>

/**
 * Extracts the table name from a Convex ID string.
 * Convex IDs are formatted as "tableName:id".
 */
function tableNameFromId(id: string): string {
  // Convex IDs contain the table name — extract it
  // In practice, consumers pass the table name explicitly for queries
  // For .get(), we infer from the ID format
  const colonIdx = id.indexOf(':')
  return colonIdx > 0 ? id.substring(0, colonIdx) : ''
}

/**
 * Get the doc schema for a table from zodTables.
 */
function getDocSchema(zodTables: ZodTables, table: string): z.ZodTypeAny | undefined {
  return zodTables[table]?.schema?.doc
}

/**
 * Decode a single document using the table's schema.
 * Returns null if input is null.
 */
function decodeOne(schema: z.ZodTypeAny | undefined, doc: any): any {
  if (doc === null || doc === undefined) return null
  if (!schema) return doc
  return decodeDoc(schema, doc)
}

/**
 * Decode an array of documents using the table's schema.
 */
function decodeMany(schema: z.ZodTypeAny | undefined, docs: any[]): any[] {
  if (!schema) return docs
  return docs.map(doc => decodeDoc(schema, doc))
}

// ============================================================================
// Query Chain Wrapper
// ============================================================================

/**
 * Wraps a Convex query chain, intercepting terminal methods to decode results.
 * Delegates query-building methods (withIndex, filter, order) to the underlying query.
 */
class ZodQueryChain {
  private inner: any
  private schema: z.ZodTypeAny | undefined
  private hooks: DatabaseHooks | undefined
  private ctx: any
  private table: string

  constructor(inner: any, schema: z.ZodTypeAny | undefined, table: string, hooks?: DatabaseHooks, ctx?: any) {
    this.inner = inner
    this.schema = schema
    this.hooks = hooks
    this.ctx = ctx
    this.table = table
  }

  // Query-building methods — pure delegation
  withIndex(name: string, builder?: (q: any) => any): ZodQueryChain {
    const next = builder ? this.inner.withIndex(name, builder) : this.inner.withIndex(name)
    return new ZodQueryChain(next, this.schema, this.table, this.hooks, this.ctx)
  }

  filter(predicate: (q: any) => any): ZodQueryChain {
    return new ZodQueryChain(this.inner.filter(predicate), this.schema, this.table, this.hooks, this.ctx)
  }

  order(order: 'asc' | 'desc'): ZodQueryChain {
    return new ZodQueryChain(this.inner.order(order), this.schema, this.table, this.hooks, this.ctx)
  }

  // Terminal methods — intercept, decode, apply hooks
  async first(): Promise<any> {
    const raw = await this.inner.first()
    if (raw === null) return null
    return this.decodeOneWithHooks(raw, 'first')
  }

  async unique(): Promise<any> {
    const raw = await this.inner.unique()
    if (raw === null) return null
    return this.decodeOneWithHooks(raw, 'unique')
  }

  async collect(): Promise<any[]> {
    const rawDocs = await this.inner.collect()
    return this.decodeManyWithHooks(rawDocs, 'collect')
  }

  async take(n: number): Promise<any[]> {
    const rawDocs = await this.inner.take(n)
    return this.decodeManyWithHooks(rawDocs, 'take')
  }

  async paginate(opts: any): Promise<any> {
    const result = await this.inner.paginate(opts)
    const decodedPage = await this.decodeManyWithHooks(result.page, 'paginate')
    return { ...result, page: decodedPage }
  }

  // Internal helpers
  private async decodeOneWithHooks(raw: any, operation: string): Promise<any> {
    let doc = raw

    // decode.before.one hook
    if (this.hooks?.decode?.before?.one) {
      const hookCtx = { ...this.ctx, table: this.table, operation }
      doc = await this.hooks.decode.before.one(hookCtx, doc)
      if (doc === null) return null
    }

    // Codec decode
    const decoded = decodeOne(this.schema, doc)
    if (decoded === null) return null

    // decode.after.one hook
    if (this.hooks?.decode?.after?.one) {
      const hookCtx = { ...this.ctx, table: this.table, operation }
      return this.hooks.decode.after.one(hookCtx, decoded)
    }

    return decoded
  }

  private async decodeManyWithHooks(rawDocs: any[], operation: string): Promise<any[]> {
    let docs = rawDocs

    // decode.before.many hook (or map over one)
    if (this.hooks?.decode?.before?.many) {
      const hookCtx = { ...this.ctx, table: this.table, operation }
      const boundOne = async (doc: any) => {
        if (this.hooks?.decode?.before?.one) {
          return this.hooks.decode.before.one(hookCtx, doc)
        }
        return doc
      }
      docs = await this.hooks.decode.before.many(hookCtx, docs, boundOne)
    } else if (this.hooks?.decode?.before?.one) {
      const hookCtx = { ...this.ctx, table: this.table, operation }
      const filtered: any[] = []
      for (const doc of docs) {
        const result = await this.hooks.decode.before.one(hookCtx, doc)
        if (result !== null) filtered.push(result)
      }
      docs = filtered
    }

    // Codec decode
    const decoded = decodeMany(this.schema, docs)

    // decode.after.many hook (or map over one)
    if (this.hooks?.decode?.after?.many) {
      const hookCtx = { ...this.ctx, table: this.table, operation }
      const boundOne = async (doc: any) => {
        if (this.hooks?.decode?.after?.one) {
          return this.hooks.decode.after.one(hookCtx, doc)
        }
        return doc
      }
      return this.hooks.decode.after.many(hookCtx, decoded, boundOne)
    } else if (this.hooks?.decode?.after?.one) {
      const hookCtx = { ...this.ctx, table: this.table, operation }
      const filtered: any[] = []
      for (const doc of decoded) {
        const result = await this.hooks.decode.after.one(hookCtx, doc)
        if (result !== null) filtered.push(result)
      }
      return filtered
    }

    return decoded
  }
}

// ============================================================================
// DB Reader Wrapper
// ============================================================================

/**
 * Creates a codec-aware database reader.
 * Wraps ctx.db with auto-decode on reads.
 */
export function createZodDbReader(
  db: any,
  zodTables: ZodTables,
  hooks?: DatabaseHooks,
  ctx?: any,
) {
  return {
    get: async (id: any) => {
      const raw = await db.get(id)
      if (raw === null) return null

      const table = tableNameFromId(String(id))
      const schema = getDocSchema(zodTables, table)

      if (hooks?.decode?.before?.one) {
        const hookCtx = { ...ctx, table, operation: 'get' as const }
        const hooked = await hooks.decode.before.one(hookCtx, raw)
        if (hooked === null) return null
        const decoded = decodeOne(schema, hooked)
        if (hooks?.decode?.after?.one) {
          return hooks.decode.after.one(hookCtx, decoded)
        }
        return decoded
      }

      const decoded = decodeOne(schema, raw)

      if (hooks?.decode?.after?.one) {
        const hookCtx = { ...ctx, table, operation: 'get' as const }
        return hooks.decode.after.one(hookCtx, decoded)
      }

      return decoded
    },

    query: (table: string) => {
      const schema = getDocSchema(zodTables, table)
      const inner = db.query(table)
      return new ZodQueryChain(inner, schema, table, hooks, ctx)
    },

    // Expose system for passthrough (normalQuery, systemQuery, etc.)
    system: db.system,
  }
}
```

Update `src/db/index.ts`:

```typescript
export * from './primitives'
export * from './hooks'
export { createZodDbReader } from './wrapper'
```

**Step 4: Run test to verify it passes**

Run: `bun test __tests__/db/wrapper-reader.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/db/wrapper.ts src/db/index.ts __tests__/db/wrapper-reader.test.ts
git commit -m "feat: add codec-aware DB reader wrapper"
```

---

### Task 6: Codec-aware DB wrapper — Writer

**Files:**
- Modify: `src/db/wrapper.ts`
- Modify: `src/db/index.ts`
- Test: `__tests__/db/wrapper-writer.test.ts`

**Step 1: Write the failing test**

Create `__tests__/db/wrapper-writer.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { zx } from '../src/zx'
import { zodTable } from '../src/tables'
import { createZodDbWriter } from '../src/db/wrapper'

const Events = zodTable('events', {
  title: z.string(),
  startDate: zx.date(),
})

const zodTables = { events: Events }

function mockDbWriter() {
  const store: Record<string, any> = {}
  let nextId = 1

  return {
    store,
    db: {
      get: async (id: string) => store[id] ?? null,
      query: (table: string) => ({
        collect: async () => Object.values(store).filter((d: any) => d._table === table),
        first: async () => Object.values(store).filter((d: any) => d._table === table)[0] ?? null,
        unique: async () => null,
        take: async (n: number) => Object.values(store).filter((d: any) => d._table === table).slice(0, n),
        withIndex: function() { return this },
        order: function() { return this },
        filter: function() { return this },
      }),
      insert: async (table: string, doc: any) => {
        const id = `${table}:${nextId++}`
        store[id] = { ...doc, _id: id, _creationTime: Date.now(), _table: table }
        return id
      },
      patch: async (id: string, patch: any) => {
        if (!store[id]) throw new Error('Not found')
        Object.assign(store[id], patch)
      },
      delete: async (id: string) => {
        delete store[id]
      },
    },
  }
}

describe('createZodDbWriter', () => {
  it('encodes Date to timestamp on insert', async () => {
    const { db, store } = mockDbWriter()
    const zodDb = createZodDbWriter(db as any, zodTables)

    const id = await zodDb.insert('events', {
      title: 'Meeting',
      startDate: new Date(1700000000000),
    })

    expect(store[id].startDate).toBe(1700000000000)
    expect(typeof store[id].startDate).toBe('number')
    expect(store[id].title).toBe('Meeting')
  })

  it('encodes Date to timestamp on patch', async () => {
    const { db, store } = mockDbWriter()
    store['events:1'] = {
      _id: 'events:1',
      _creationTime: 1000,
      _table: 'events',
      title: 'Old',
      startDate: 1600000000000,
    }

    const zodDb = createZodDbWriter(db as any, zodTables)
    await zodDb.patch('events:1' as any, {
      startDate: new Date(1700000000000),
    })

    expect(store['events:1'].startDate).toBe(1700000000000)
  })

  it('delete passes through to underlying db', async () => {
    const { db, store } = mockDbWriter()
    store['events:1'] = { _id: 'events:1', _table: 'events' }

    const zodDb = createZodDbWriter(db as any, zodTables)
    await zodDb.delete('events:1' as any)

    expect(store['events:1']).toBeUndefined()
  })

  it('writer also supports reading (get/query)', async () => {
    const { db, store } = mockDbWriter()
    store['events:1'] = {
      _id: 'events:1',
      _creationTime: 1000,
      _table: 'events',
      title: 'Test',
      startDate: 1700000000000,
    }

    const zodDb = createZodDbWriter(db as any, zodTables)
    const event = await zodDb.get('events:1' as any)

    expect(event!.startDate).toBeInstanceOf(Date)
  })

  it('calls encode.before hook on insert', async () => {
    const log: string[] = []
    const { db } = mockDbWriter()

    const hooks = {
      encode: {
        before: async (_ctx: any, doc: any) => {
          log.push('encode.before')
          return doc
        },
      },
    }

    const zodDb = createZodDbWriter(db as any, zodTables, hooks)
    await zodDb.insert('events', {
      title: 'Test',
      startDate: new Date(1700000000000),
    })

    expect(log).toContain('encode.before')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test __tests__/db/wrapper-writer.test.ts`
Expected: FAIL — cannot import `createZodDbWriter`

**Step 3: Write minimal implementation**

Add to `src/db/wrapper.ts`:

```typescript
import { encodeDoc } from './primitives'

/**
 * Get the base schema (without system fields) for encoding.
 */
function getBaseSchema(zodTables: ZodTables, table: string): z.ZodTypeAny | undefined {
  return zodTables[table]?.schema?.base
}

/**
 * Encode fields for a write operation.
 * Uses the base schema (no system fields) for insert,
 * and partial encoding for patch.
 */
function encodeForWrite(zodTables: ZodTables, table: string, doc: any, operation: 'insert' | 'patch'): any {
  const baseSchema = getBaseSchema(zodTables, table)
  if (!baseSchema) return doc

  if (operation === 'insert') {
    return encodeDoc(baseSchema, doc)
  }

  // For patch: encode only the fields present in the patch
  // We can't use the full schema since not all fields are present
  if (baseSchema instanceof z.ZodObject) {
    const encoded: Record<string, any> = {}
    for (const [key, value] of Object.entries(doc)) {
      const fieldSchema = baseSchema.shape[key]
      if (fieldSchema && value !== undefined) {
        try {
          encoded[key] = z.encode(fieldSchema as z.ZodTypeAny, value)
        } catch {
          encoded[key] = value
        }
      } else if (value !== undefined) {
        encoded[key] = value
      }
    }
    return encoded
  }

  return doc
}

/**
 * Creates a codec-aware database writer.
 * Extends the reader with insert/patch/delete that auto-encode.
 */
export function createZodDbWriter(
  db: any,
  zodTables: ZodTables,
  hooks?: DatabaseHooks,
  ctx?: any,
) {
  const reader = createZodDbReader(db, zodTables, hooks, ctx)

  return {
    ...reader,

    insert: async (table: string, doc: any) => {
      let processed = doc

      // encode.before hook
      if (hooks?.encode?.before) {
        const hookCtx = { ...ctx, table, operation: 'insert' as const }
        const result = await hooks.encode.before(hookCtx, processed)
        if (result === null) throw new Error(`Insert denied on ${table}`)
        processed = result
      }

      // Codec encode
      const encoded = encodeForWrite(zodTables, table, processed, 'insert')

      const id = await db.insert(table, encoded)

      // encode.after hook
      if (hooks?.encode?.after) {
        const hookCtx = { ...ctx, table, operation: 'insert' as const }
        await hooks.encode.after(hookCtx, encoded)
      }

      return id
    },

    patch: async (id: any, patch: any) => {
      const table = tableNameFromId(String(id))
      let processed = patch

      // Fetch existing doc for hook context
      const existingDoc = await db.get(id)

      // encode.before hook
      if (hooks?.encode?.before) {
        const hookCtx = { ...ctx, table, operation: 'patch' as const, existingDoc }
        const result = await hooks.encode.before(hookCtx, processed)
        if (result === null) throw new Error(`Patch denied on ${table}`)
        processed = result
      }

      // Codec encode
      const encoded = encodeForWrite(zodTables, table, processed, 'patch')

      await db.patch(id, encoded)

      // encode.after hook
      if (hooks?.encode?.after) {
        const hookCtx = { ...ctx, table, operation: 'patch' as const, existingDoc }
        await hooks.encode.after(hookCtx, encoded)
      }
    },

    delete: async (id: any) => {
      const table = tableNameFromId(String(id))

      // Fetch existing doc for hook context
      const existingDoc = await db.get(id)

      // encode.before hook for delete (optional, allows denial)
      if (hooks?.encode?.before) {
        const hookCtx = { ...ctx, table, operation: 'delete' as const, existingDoc }
        const result = await hooks.encode.before(hookCtx, existingDoc ?? {})
        if (result === null) throw new Error(`Delete denied on ${table}`)
      }

      await db.delete(id)

      // encode.after hook
      if (hooks?.encode?.after) {
        const hookCtx = { ...ctx, table, operation: 'delete' as const, existingDoc }
        await hooks.encode.after(hookCtx, existingDoc ?? {})
      }
    },
  }
}
```

Update `src/db/index.ts`:

```typescript
export * from './primitives'
export * from './hooks'
export { createZodDbReader, createZodDbWriter } from './wrapper'
```

**Step 4: Run test to verify it passes**

Run: `bun test __tests__/db/wrapper-writer.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/db/wrapper.ts src/db/index.ts __tests__/db/wrapper-writer.test.ts
git commit -m "feat: add codec-aware DB writer wrapper"
```

---

### Task 7: `initZodvex()` + `zCustomCtx` / `zCustomCtxWithArgs`

**Files:**
- Create: `src/init.ts`
- Modify: `src/server/index.ts`
- Test: `__tests__/init.test.ts`

**Step 1: Write the failing test**

Create `__tests__/init.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { zx } from '../src/zx'
import { zodTable } from '../src/tables'
import { defineZodSchema } from '../src/schema'
import { initZodvex } from '../src/init'

const Events = zodTable('events', {
  title: z.string(),
  startDate: zx.date(),
})

const Users = zodTable('users', {
  name: z.string(),
  email: z.string(),
})

const schema = defineZodSchema({ events: Events, users: Users })

// Mock server
const server = {
  query: (fn: any) => fn,
  mutation: (fn: any) => fn,
  action: (fn: any) => fn,
  internalQuery: (fn: any) => fn,
  internalMutation: (fn: any) => fn,
  internalAction: (fn: any) => fn,
}

describe('initZodvex', () => {
  it('returns builders: zq, zm, za, ziq, zim, zia', () => {
    const result = initZodvex(schema, server as any)
    expect(result.zq).toBeDefined()
    expect(result.zm).toBeDefined()
    expect(result.za).toBeDefined()
    expect(result.ziq).toBeDefined()
    expect(result.zim).toBeDefined()
    expect(result.zia).toBeDefined()
  })

  it('returns zCustomCtx and zCustomCtxWithArgs', () => {
    const result = initZodvex(schema, server as any)
    expect(result.zCustomCtx).toBeDefined()
    expect(result.zCustomCtxWithArgs).toBeDefined()
  })

  it('zq produces a function when called with config', () => {
    const { zq } = initZodvex(schema, server as any)
    const fn = zq({
      args: { title: z.string() },
      handler: async (ctx: any, args: any) => {
        return args.title
      },
    })
    expect(fn).toBeDefined()
  })

  it('zq.withContext returns a new builder', () => {
    const { zq, zCustomCtx } = initZodvex(schema, server as any)
    const authCtx = zCustomCtx(async (ctx: any) => {
      return { user: { name: 'test' } }
    })
    const authQuery = zq.withContext(authCtx)
    expect(authQuery).toBeDefined()
    expect(typeof authQuery).toBe('function')
  })

  it('zq.withContext().withHooks() returns a new builder', () => {
    const { zq, zCustomCtx } = initZodvex(schema, server as any)
    const authCtx = zCustomCtx(async (ctx: any) => {
      return { user: { name: 'test' } }
    })
    const hooks = {
      decode: {
        after: {
          one: async (_ctx: any, doc: any) => doc,
        },
      },
    }
    const hooked = zq.withContext(authCtx).withHooks(hooks)
    expect(hooked).toBeDefined()
    expect(typeof hooked).toBe('function')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test __tests__/init.test.ts`
Expected: FAIL — cannot import `initZodvex`

**Step 3: Write minimal implementation**

Create `src/init.ts`:

```typescript
import type { DatabaseHooks } from './db/hooks'
import { createZodDbReader, createZodDbWriter } from './db/wrapper'

type ZodTables = Record<string, { name: string; table: any; schema: { doc: any; base: any } }>

type ZodSchema = {
  tables: Record<string, any>
  zodTables: ZodTables
}

type Server = {
  query: any
  mutation: any
  action: any
  internalQuery: any
  internalMutation: any
  internalAction: any
}

type CustomCtxFn<ExtraArgs = any> = (ctx: any, extra?: ExtraArgs) => Promise<Record<string, any>> | Record<string, any>

type CustomCtxWithArgsFn<ExtraArgs = any> = {
  args: Record<string, any>
  input: (ctx: any, args: any, extra?: ExtraArgs) => Promise<Record<string, any>> | Record<string, any>
}

type BuilderWithComposition = {
  (config: any): any
  withContext: (customization: any) => BuilderWithComposition
  withHooks: (hooks: DatabaseHooks) => BuilderWithComposition
}

/**
 * Creates a builder function with .withContext() and .withHooks() methods.
 */
function createComposableBuilder(
  baseBuilder: any,
  zodTables: ZodTables,
  isWriter: boolean,
  customCtxFn?: CustomCtxFn | null,
  hooks?: DatabaseHooks | null,
): BuilderWithComposition {
  const builder = function (config: any) {
    const { args, handler, returns, ...extra } = config

    return baseBuilder({
      args,
      returns,
      handler: async (ctx: any, parsedArgs: any) => {
        let augmentedCtx = ctx

        // Apply custom context
        if (customCtxFn) {
          const added = await customCtxFn(ctx, extra)
          augmentedCtx = { ...ctx, ...added }
        }

        // Wrap ctx.db with codec-aware wrapper
        if (augmentedCtx.db) {
          augmentedCtx = {
            ...augmentedCtx,
            db: isWriter
              ? createZodDbWriter(augmentedCtx.db, zodTables, hooks ?? undefined, augmentedCtx)
              : createZodDbReader(augmentedCtx.db, zodTables, hooks ?? undefined, augmentedCtx),
          }
        }

        return handler(augmentedCtx, parsedArgs)
      },
    })
  } as BuilderWithComposition

  builder.withContext = (customization: any) => {
    return createComposableBuilder(baseBuilder, zodTables, isWriter, customization._fn ?? customization, hooks)
  }

  builder.withHooks = (newHooks: DatabaseHooks) => {
    return createComposableBuilder(baseBuilder, zodTables, isWriter, customCtxFn, newHooks)
  }

  return builder
}

/**
 * One-time setup that creates all pre-configured builders.
 * Accepts the schema from defineZodSchema() and the Convex server functions.
 */
export function initZodvex(schema: ZodSchema, server: Server) {
  const zodTables = schema.zodTables

  const zq = createComposableBuilder(server.query, zodTables, false)
  const zm = createComposableBuilder(server.mutation, zodTables, true)
  const za = createComposableBuilder(server.action, zodTables, false)
  const ziq = createComposableBuilder(server.internalQuery, zodTables, false)
  const zim = createComposableBuilder(server.internalMutation, zodTables, true)
  const zia = createComposableBuilder(server.internalAction, zodTables, false)

  /**
   * Context customization factory — parallels convex-helpers' customCtx.
   * Returns a customization object compatible with .withContext().
   */
  function zCustomCtx<ExtraArgs = any>(fn: CustomCtxFn<ExtraArgs>) {
    return { _fn: fn }
  }

  /**
   * Context customization with custom args — parallels customCtxAndArgs.
   */
  function zCustomCtxWithArgs<ExtraArgs = any>(config: CustomCtxWithArgsFn<ExtraArgs>) {
    return { _fn: config.input, _args: config.args }
  }

  return {
    zq, zm, za,
    ziq, zim, zia,
    zCustomCtx,
    zCustomCtxWithArgs,
  }
}
```

Add to `src/server/index.ts`:

```typescript
export * from '../init'
```

**Step 4: Run test to verify it passes**

Run: `bun test __tests__/init.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/init.ts src/server/index.ts __tests__/init.test.ts
git commit -m "feat: add initZodvex with composable builders"
```

---

### Task 8: Scaffold `example/` project

**Files:**
- Create: `example/convex/_generated/server.ts`
- Create: `example/convex/_generated/dataModel.d.ts`
- Create: `example/convex/stateCode.ts`
- Create: `example/convex/schema.ts`
- Create: `example/convex/setup.ts`
- Create: `example/convex/events.ts`
- Create: `example/convex/users.ts`
- Create: `example/convex/admin.ts`
- Delete: `examples/basic-usage.ts`
- Delete: `examples/queries.ts`

**Step 1: Create mock server**

`example/convex/_generated/server.ts`:

```typescript
// Mock Convex server exports for the example project
export const query = (fn: any) => fn
export const mutation = (fn: any) => fn
export const action = (fn: any) => fn
export const internalQuery = (fn: any) => fn
export const internalMutation = (fn: any) => fn
export const internalAction = (fn: any) => fn
```

`example/convex/_generated/dataModel.d.ts`:

```typescript
export type Id<TableName extends string> = string & { __tableName: TableName }
export type Doc<TableName extends string> = any
```

**Step 2: Create stateCode codec**

`example/convex/stateCode.ts`:

```typescript
import { z } from 'zod'
import { zx } from 'zodvex/core'

const STATE_MAP: Record<string, string> = {
  CA: 'California',
  NY: 'New York',
  TX: 'Texas',
}

const REVERSE_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_MAP).map(([k, v]) => [v, k])
)

/**
 * Custom codec: 2-letter state codes ↔ full state names.
 *
 * Wire format (stored in Convex): "CA", "NY", "TX"
 * Runtime format (used in code): "California", "New York", "Texas"
 */
export const stateCode = () =>
  zx.codec(
    z.string(), // wire
    z.string(), // runtime
    {
      decode: (code: string) => STATE_MAP[code] ?? code,
      encode: (name: string) => REVERSE_MAP[name] ?? name,
    }
  )
```

**Step 3: Create schema**

`example/convex/schema.ts`:

```typescript
import { z } from 'zod'
import { zx } from 'zodvex/core'
import { defineZodSchema, zodTable } from 'zodvex/server'
import { stateCode } from './stateCode'

export const Users = zodTable('users', {
  name: z.string(),
  email: z.string(),
  state: stateCode(),
})

export const Events = zodTable('events', {
  title: z.string(),
  startDate: zx.date(),
  endDate: zx.date().optional(),
  organizerId: zx.id('users'),
})

export default defineZodSchema({
  users: Users,
  events: Events,
})
```

**Step 4: Create setup (builder composition)**

`example/convex/setup.ts`:

```typescript
import { createDatabaseHooks, composeHooks, initZodvex } from 'zodvex/server'
import schema from './schema'
import * as server from './_generated/server'

// ============================================================================
// Initialize zodvex — one-time setup
// ============================================================================

export const {
  zq, zm, za,
  ziq, zim, zia,
  zCustomCtx,
} = initZodvex(schema, server)

// ============================================================================
// Context Customization
// ============================================================================

/** Simple auth context — adds user to ctx */
const authCtx = zCustomCtx(async (ctx: any) => {
  // In a real app: const identity = await ctx.auth.getUserIdentity()
  const user = { name: 'Test User', role: 'user' }
  return { user }
})

/** Admin context with ExtraArgs for required roles */
const adminCtx = zCustomCtx(async (ctx: any, extra?: { required?: string[] }) => {
  const user = { name: 'Admin User', role: 'admin' }
  if (extra?.required && !extra.required.includes(user.role)) {
    throw new Error(`Missing required role: ${extra.required.join(', ')}`)
  }
  return { user }
})

// ============================================================================
// DB Hooks
// ============================================================================

/** Logging hook — logs after decode */
const loggingHooks = createDatabaseHooks<{ user: { name: string } }>({
  decode: {
    after: {
      one: async (ctx, doc) => {
        // In a real app: audit log
        console.log(`[read] ${ctx.table} by ${ctx.user.name}`)
        return doc
      },
    },
  },
})

/** Validation hook — checks admin role before decode */
const validationHooks = createDatabaseHooks<{ user: { role: string } }>({
  decode: {
    before: {
      one: async (ctx, doc) => {
        if (ctx.user.role !== 'admin') return null // deny
        return doc
      },
    },
  },
})

const adminHooks = composeHooks([validationHooks, loggingHooks])

// ============================================================================
// Composed Builders
// ============================================================================

export const authQuery = zq.withContext(authCtx)
export const authMutation = zm.withContext(authCtx)
export const adminQuery = zq.withContext(adminCtx).withHooks(adminHooks)
export const adminMutation = zm.withContext(adminCtx).withHooks(adminHooks)
```

**Step 5: Create handler files**

`example/convex/events.ts`:

```typescript
import { z } from 'zod'
import { zx } from 'zodvex/core'
import { zq, zm } from './setup'
import { Events } from './schema'

export const get = zq({
  args: { eventId: zx.id('events') },
  returns: Events.schema.doc.nullable(),
  handler: async (ctx: any, { eventId }: any) => {
    return ctx.db.get(eventId)
  },
})

export const listUpcoming = zq({
  args: {},
  returns: Events.schema.docArray,
  handler: async (ctx: any) => {
    return ctx.db.query('events').collect()
  },
})

export const create = zm({
  args: {
    title: z.string(),
    startDate: zx.date(),
    endDate: zx.date().optional(),
    organizerId: zx.id('users'),
  },
  handler: async (ctx: any, args: any) => {
    return ctx.db.insert('events', args)
  },
})
```

`example/convex/users.ts`:

```typescript
import { z } from 'zod'
import { authQuery, authMutation } from './setup'
import { Users } from './schema'
import { stateCode } from './stateCode'

export const get = authQuery({
  args: { userId: z.string() },
  returns: Users.schema.doc.nullable(),
  handler: async (ctx: any, { userId }: any) => {
    return ctx.db.get(userId)
  },
})

export const list = authQuery({
  args: {},
  returns: Users.schema.docArray,
  handler: async (ctx: any) => {
    return ctx.db.query('users').collect()
  },
})

export const create = authMutation({
  args: {
    name: z.string(),
    email: z.string(),
    state: stateCode(),
  },
  handler: async (ctx: any, args: any) => {
    // args.state is runtime format ("California")
    // DB wrapper encodes to wire format ("CA") on insert
    return ctx.db.insert('users', args)
  },
})
```

`example/convex/admin.ts`:

```typescript
import { z } from 'zod'
import { adminQuery } from './setup'
import { Users } from './schema'

export const listAllUsers = adminQuery({
  args: {},
  required: ['admin'],
  returns: Users.schema.docArray,
  handler: async (ctx: any) => {
    // Only reaches handler if admin role check passes (via hooks)
    return ctx.db.query('users').collect()
  },
})
```

**Step 6: Delete old examples**

```bash
rm examples/basic-usage.ts examples/queries.ts
rmdir examples
```

**Step 7: Commit**

```bash
git add example/ && git rm -r examples/
git commit -m "feat: scaffold example project exercising full zodvex API"
```

---

### Task 9: Integration tests

**Files:**
- Test: `__tests__/integration/codec-pipeline.test.ts`

**Step 1: Write integration test**

Create `__tests__/integration/codec-pipeline.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { zx } from '../../src/zx'
import { zodTable } from '../../src/tables'
import { defineZodSchema } from '../../src/schema'
import { initZodvex } from '../../src/init'
import { createDatabaseHooks, composeHooks } from '../../src/db/hooks'

// ============================================================================
// Setup (mirrors example/convex/schema.ts pattern)
// ============================================================================

const STATE_MAP: Record<string, string> = { CA: 'California', NY: 'New York' }
const REVERSE_MAP: Record<string, string> = { California: 'CA', 'New York': 'NY' }

const stateCode = () =>
  zx.codec(z.string(), z.string(), {
    decode: (code: string) => STATE_MAP[code] ?? code,
    encode: (name: string) => REVERSE_MAP[name] ?? name,
  })

const Users = zodTable('users', {
  name: z.string(),
  email: z.string(),
  state: stateCode(),
})

const Events = zodTable('events', {
  title: z.string(),
  startDate: zx.date(),
  endDate: zx.date().optional(),
  organizerId: zx.id('users'),
})

const schema = defineZodSchema({ users: Users, events: Events })

// In-memory mock database
function createMockDb() {
  const store: Record<string, any> = {}
  let nextId = 1

  return {
    store,
    get: async (id: string) => store[id] ?? null,
    query: (table: string) => {
      const docs = () => Object.values(store).filter((d: any) => d._table === table)
      return {
        collect: async () => docs(),
        first: async () => docs()[0] ?? null,
        unique: async () => docs().length === 1 ? docs()[0] : null,
        take: async (n: number) => docs().slice(0, n),
        withIndex: function() { return this },
        order: function() { return this },
        filter: function() { return this },
      }
    },
    insert: async (table: string, doc: any) => {
      const id = `${table}:${nextId++}`
      store[id] = { ...doc, _id: id, _creationTime: Date.now(), _table: table }
      return id
    },
    patch: async (id: string, patch: any) => {
      if (!store[id]) throw new Error('Not found')
      Object.assign(store[id], patch)
    },
    delete: async (id: string) => {
      delete store[id]
    },
  }
}

// Mock server that passes handler through but injects mock db
function createMockServer(db: any) {
  const wrapper = (fn: any) => {
    // Return the handler with ctx.db injected
    return {
      ...fn,
      _handler: fn.handler,
      _invoke: async (args: any) => fn.handler({ db }, args),
    }
  }
  return {
    query: wrapper,
    mutation: wrapper,
    action: wrapper,
    internalQuery: wrapper,
    internalMutation: wrapper,
    internalAction: wrapper,
  }
}

describe('Full codec pipeline integration', () => {
  it('decodes zx.date() on read through initZodvex builder', async () => {
    const db = createMockDb()
    // Seed wire-format data
    db.store['events:1'] = {
      _id: 'events:1',
      _creationTime: 1000,
      _table: 'events',
      title: 'Meeting',
      startDate: 1700000000000,
      organizerId: 'users:1',
    }

    const server = createMockServer(db)
    const { zq } = initZodvex(schema, server as any)

    const getEvent = zq({
      args: { eventId: zx.id('events') },
      handler: async (ctx: any, { eventId }: any) => {
        const event = await ctx.db.get(eventId)
        // Should be decoded: Date, not number
        expect(event.startDate).toBeInstanceOf(Date)
        expect(event.startDate.getTime()).toBe(1700000000000)
        return event
      },
    })

    await getEvent._invoke({ eventId: 'events:1' })
  })

  it('encodes stateCode() on write through initZodvex builder', async () => {
    const db = createMockDb()
    const server = createMockServer(db)
    const { zm } = initZodvex(schema, server as any)

    const createUser = zm({
      args: { name: z.string(), email: z.string(), state: stateCode() },
      handler: async (ctx: any, args: any) => {
        return ctx.db.insert('users', args)
      },
    })

    const id = await createUser._invoke({
      name: 'John',
      email: 'john@test.com',
      state: 'California',
    })

    // Wire format in DB should be "CA"
    expect(db.store[id].state).toBe('CA')
  })

  it('hooks compose correctly: validation then logging', async () => {
    const log: string[] = []
    const db = createMockDb()
    db.store['users:1'] = {
      _id: 'users:1',
      _creationTime: 1000,
      _table: 'users',
      name: 'John',
      email: 'john@test.com',
      state: 'CA',
    }

    const server = createMockServer(db)
    const { zq, zCustomCtx } = initZodvex(schema, server as any)

    const adminCtx = zCustomCtx(async () => ({
      user: { name: 'Admin', role: 'admin' },
    }))

    const validationHooks = createDatabaseHooks<any>({
      decode: {
        before: {
          one: async (ctx: any, doc: any) => {
            log.push('validation')
            if (ctx.user.role !== 'admin') return null
            return doc
          },
        },
      },
    })

    const loggingHooks = createDatabaseHooks<any>({
      decode: {
        after: {
          one: async (ctx: any, doc: any) => {
            log.push('logging')
            return doc
          },
        },
      },
    })

    const composed = composeHooks([validationHooks, loggingHooks])
    const adminQuery = zq.withContext(adminCtx).withHooks(composed)

    const listUsers = adminQuery({
      args: {},
      handler: async (ctx: any) => {
        return ctx.db.query('users').collect()
      },
    })

    await listUsers._invoke({})
    expect(log).toEqual(['validation', 'logging'])
  })
})
```

**Step 2: Run test to verify it passes**

Run: `bun test __tests__/integration/codec-pipeline.test.ts`
Expected: PASS (all prior tasks implemented)

**Step 3: Run full test suite**

Run: `bun test`
Expected: All tests pass (existing + new)

**Step 4: Run type check**

Run: `bun run type-check`
Expected: No errors

**Step 5: Commit**

```bash
git add __tests__/integration/codec-pipeline.test.ts
git commit -m "test: add full codec pipeline integration tests"
```

---

### Task 10: Final verification and cleanup

**Step 1: Run all tests**

Run: `bun test`
Expected: All pass

**Step 2: Run linting**

Run: `bun run lint`
Fix any issues with: `bun run lint:fix`

**Step 3: Run type check**

Run: `bun run type-check`
Expected: Clean

**Step 4: Commit any lint fixes**

```bash
git add -A && git commit -m "chore: lint fixes"
```
