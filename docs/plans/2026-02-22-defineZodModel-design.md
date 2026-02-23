# `defineZodModel` Design: Client-Safe Model Definitions with Type-Safe Indexes

> Client-safe spiritual successor to `zodTable`. Produces Zod schemas for codec decode/encode, type-safe index definitions via `z.input<T>` field path extraction, and extensible metadata for framework wrapping (hotpot rules, etc.).

**Depends on:** Spike validated in `__tests__/defineZodModel-spike.test.ts` (commit `c503a6f`)

**References:**
- `2026-02-15-codec-db-infrastructure-design.md` — codegen architecture (`_generated/zodvex/`)
- `2026-02-18-composition-layer-design.md` — `defineZodSchema` + `initZodvex`
- `2026-02-18-hotpot-initZodvex-adoption.md` — hotpot wrapping pattern

---

## 1. Problem

`zodTable()` imports `defineTable` from `convex/server` and `Table` from `convex-helpers/server`. This makes it server-only — model schemas (`zodTable().schema.doc`, `.schema.insert`) are trapped behind the server import boundary.

Hotpot worked around this by creating `defineHotpotModel` — a parallel Zod object harness that rebuilds the same schema shapes using only `zod` + `zodvex/core`. This works but is duplicative. zodvex should own the client-safe model primitive.

---

## 2. `defineZodModel` API

**File:** `src/model.ts`
**Export:** `zodvex/core` (client-safe)

```typescript
import { z } from 'zod'
import { zx } from 'zodvex/core'

const patients = defineZodModel('patients', {
  clinicId: z.string(),
  email: sensitive(z.string().email()).optional(),
  firstName: sensitive(z.string()),
  createdAt: zx.date(),
})
```

### Return shape

```typescript
{
  name: 'patients',                        // literal string
  fields: { clinicId: ZodString, ... },    // raw Zod shape
  schema: {
    doc: ZodObject<Fields & SystemFields>, // fields + _id + _creationTime
    insert: ZodObject<Fields>,             // user fields only
    update: ZodObject<UpdateShape>,        // _id required, user fields partial
    docArray: ZodArray<doc>,               // array of doc
  },
  indexes: {},                             // populated by .index()
  searchIndexes: {},                       // populated by .searchIndex()
  vectorIndexes: {},                       // populated by .vectorIndex()
}
```

### What it does NOT do

- Import from `convex/server` (client-safe)
- Create a Convex `TableDefinition` (deferred to `defineZodSchema`)
- Convert Zod → Convex validators (deferred to `defineZodSchema`)
- Carry domain-specific metadata like security rules (deferred to framework wrapping)

---

## 3. Type-Safe Index Definitions

The core DX win. `.index()` validates field paths against the model's wire-format structure at compile time — same guarantee as Convex's `defineTable().index()`.

### `.index()`

```typescript
const patients = defineZodModel('patients', {
  clinicId: z.string(),
  email: sensitive(z.string().email()).optional(),
  address: z.object({
    city: z.string(),
    state: z.string(),
  }),
}).index('byClinic', ['clinicId'])
  .index('byEmailValue', ['email.value'])      // ✓ wire-format path into SensitiveWire
  .index('byCity', ['address.city'])            // ✓ nested object path
  .index('byCreation', ['_creationTime'])       // ✓ system field
  // .index('bad', ['bogus'])                   // ✗ TS ERROR: not a valid field path
  // .index('bad', ['email.bogus'])             // ✗ TS ERROR: not in SensitiveWire structure
```

### How it works: `FieldPaths<z.input<T>>`

Indexes operate on Convex's wire format (what's stored in the DB). By extracting paths from `z.input<InsertSchema>` — the Zod schema's **input** (wire) type — we get exactly the paths Convex can index on.

```typescript
type FieldPaths<T> = T extends any[]
  ? never
  : T extends Record<string, any>
    ? T extends T // distribute over unions
      ? {
          [K in keyof T & string]:
            | K
            | (NonNullable<T[K]> extends any[]
                ? never
                : NonNullable<T[K]> extends Record<string, any>
                  ? `${K}.${FieldPaths<NonNullable<T[K]>>}`
                  : never)
        }[keyof T & string]
      : never
    : never

type ModelFieldPaths<InsertSchema extends z.ZodTypeAny> =
  | FieldPaths<z.input<InsertSchema>>
  | '_creationTime'
```

**Why `z.input` works for each codec:**

| Field | `z.input<T>` (wire) | Path behavior |
|-------|---------------------|---------------|
| `z.string()` | `string` | Leaf — `"clinicId"` only |
| `zx.date()` | `number` | Leaf — `"createdAt"` only |
| `zx.id('users')` | `string` | Leaf — `"organizerId"` only |
| `sensitive(z.string())` | `SensitiveWire<string>` | Object — `"email"`, `"email.value"`, `"email.status"` |
| `z.object({ city: z.string() })` | `{ city: string }` | Object — `"address"`, `"address.city"` |
| `z.union([...])` | Distributed | Paths from ALL union members |
| `z.array(z.object(...))` | `Array<...>` | Leaf — no sub-paths (can't index into arrays) |

### `.searchIndex()` / `.vectorIndex()`

Same fluent pattern, different metadata shape:

```typescript
const docs = defineZodModel('docs', {
  title: z.string(),
  body: z.string(),
  embedding: z.array(z.number()),
}).searchIndex('search_body', {
    searchField: 'body',
    filterFields: ['title'],
  })
  .vectorIndex('by_embedding', {
    vectorField: 'embedding',
    dimensions: 1536,
    filterFields: ['title'],
  })
```

Search and vector index field validation is a future enhancement — for now these accept strings (matching Convex's current API). The important type safety win is on `.index()` where `IndexRangeBuilder` relies on field path precision.

---

## 4. `.index()` Type Signature

```typescript
type ZodModel<
  Name extends string,
  Fields extends z.ZodRawShape,
  InsertSchema extends z.ZodTypeAny,
  Indexes extends Record<string, readonly string[]>,
  SearchIndexes extends Record<string, SearchIndexConfig>,
  VectorIndexes extends Record<string, VectorIndexConfig>,
> = {
  readonly name: Name
  readonly fields: Fields
  readonly schema: { ... }
  readonly indexes: Indexes
  readonly searchIndexes: SearchIndexes
  readonly vectorIndexes: VectorIndexes

  index<
    IndexName extends string,
    First extends ModelFieldPaths<InsertSchema>,
    Rest extends ModelFieldPaths<InsertSchema>[],
  >(
    name: IndexName,
    fields: readonly [First, ...Rest],
  ): ZodModel<
    Name, Fields, InsertSchema,
    Indexes & Record<IndexName, readonly [First, ...Rest, '_creationTime']>,
    SearchIndexes, VectorIndexes
  >

  searchIndex<IndexName extends string>(
    name: IndexName,
    config: SearchIndexConfig,
  ): ZodModel<
    Name, Fields, InsertSchema, Indexes,
    SearchIndexes & Record<IndexName, SearchIndexConfig>,
    VectorIndexes
  >

  vectorIndex<IndexName extends string>(
    name: IndexName,
    config: VectorIndexConfig,
  ): ZodModel<
    Name, Fields, InsertSchema, Indexes, SearchIndexes,
    VectorIndexes & Record<IndexName, VectorIndexConfig>
  >
}
```

Key details:
- `.index()` returns a new `ZodModel` with the index accumulated in `Indexes` via intersection (`&`)
- `_creationTime` is auto-appended to the index tuple (matching Convex's tiebreaker behavior)
- `First` and `Rest` are constrained to `ModelFieldPaths<InsertSchema>` — the compile-time validation
- The `InsertSchema` (not `doc` schema) is used because indexes are on user fields, not system fields. `_creationTime` is added via the `ModelFieldPaths` union.

---

## 5. Relationship to `defineZodSchema`

`defineZodSchema` absorbs `zodTable`'s server concerns. It accepts `defineZodModel` results and internally creates `TableDefinition` objects.

### Current `defineZodSchema` accepts `ZodTableEntry`

```typescript
// Current (schema.ts)
type ZodTableEntry = {
  table: any            // Convex TableDefinition
  schema: ZodTableSchemas
}
```

### Updated to also accept `ZodModel`

```typescript
// New: accepts zodTable results OR defineZodModel results
type ZodSchemaEntry =
  | ZodTableEntry                           // zodTable() — has .table already
  | ZodModel<any, any, any, any, any, any>  // defineZodModel() — needs TableDefinition created

function defineZodSchema<T extends Record<string, ZodSchemaEntry>>(tables: T) {
  for (const [name, entry] of Object.entries(tables)) {
    if ('table' in entry) {
      // zodTable result — use .table directly
      convexTables[name] = entry.table
    } else {
      // defineZodModel result — create TableDefinition from fields + indexes
      const convexFields = zodToConvexFields(entry.fields)
      let tableDef = defineTable(asTableValidator(convexFields))

      // Apply indexes
      for (const [indexName, fields] of Object.entries(entry.indexes)) {
        tableDef = tableDef.index(indexName, fields as any)
      }
      for (const [indexName, config] of Object.entries(entry.searchIndexes)) {
        tableDef = tableDef.searchIndex(indexName, config as any)
      }
      for (const [indexName, config] of Object.entries(entry.vectorIndexes)) {
        tableDef = tableDef.vectorIndex(indexName, config as any)
      }

      convexTables[name] = tableDef
    }

    zodTableMap[name] = entry.schema
  }
}
```

### Usage

```typescript
// convex/schema.ts
import { defineZodSchema } from 'zodvex/server'
import { patients } from './models/patients'  // defineZodModel result
import { Events } from './models/events'       // zodTable result (legacy)

export default defineZodSchema({
  patients,  // defineZodModel — indexes applied internally
  events: Events, // zodTable — .table used directly
})
```

Both paths produce the same output: a valid Convex schema with `__zodTableMap` for codec DB wrapping.

### The `as any` on `.index()`

When `defineZodSchema` calls `tableDef.index(indexName, fields as any)`, the `as any` bridges our `readonly string[]` to Convex's `[FirstFieldPath, ...RestFieldPaths]` tuple constraint. This is the same pattern hotpot uses in `defineHotpotTable`.

The type safety is NOT lost — it has already been validated at model definition time via `ModelFieldPaths<InsertSchema>`. The `as any` is a runtime pass-through from pre-validated data.

---

## 6. Relationship to `zodTable`

`zodTable` stays. It mirrors `convex-helpers`' `Table()` — a convenience for server-only use cases where client safety doesn't matter.

| | `zodTable` | `defineZodModel` |
|---|---|---|
| **Client-safe** | No (imports `convex/server`) | Yes (`zodvex/core`) |
| **Produces** | `TableDefinition` + schemas | Schemas + index metadata only |
| **Index safety** | Via Convex's `defineTable().index()` | Via `FieldPaths<z.input<T>>` |
| **Used with** | `defineZodSchema` directly | `defineZodSchema` (creates TableDefinition internally) |
| **Extensible** | No | Yes (wrapping pattern) |
| **Recommended for** | Simple server-only projects | All new projects, especially with client code |

`zodTable` is not deprecated. Projects that don't need client-safe schemas can continue using it.

---

## 7. Extensibility: Framework Wrapping

`defineZodModel` is the generic primitive. Frameworks like hotpot wrap it to add domain metadata.

### Before (current hotpot)

```typescript
// hotpot/model.ts — builds schemas from scratch
export function defineHotpotModel(config) {
  const insertSchema = z.object(config.fields)     // duplicates zodvex logic
  const docSchema = insertSchema.extend({ _id, _creationTime })
  return { name, fields, schema: { doc, insert, docArray }, index, rules }
}
```

### After (with defineZodModel)

```typescript
// hotpot/model.ts — wraps zodvex model, adds rules
import { defineZodModel, type ZodModel } from 'zodvex/core'

export function defineHotpotModel<M extends ZodModel>(
  model: M,
  config: { rules?: ModelRules },
): M & { rules?: ModelRules } {
  return { ...model, ...config }
}

// Usage
const patients = defineHotpotModel(
  defineZodModel('patients', {
    clinicId: z.string(),
    email: sensitive(z.string().email()).optional(),
  }).index('byClinic', ['clinicId'])
    .index('byEmailValue', ['email.value']),
  {
    rules: {
      rls: { read: { requirements: { role: 'provider' } } },
      fls: { default: { read: [{ status: 'full', requirements: { role: 'provider' } }] } },
    },
  },
)
```

`defineHotpotModel` shrinks from "build Zod schemas + carry rules + carry indexes" to "attach rules to a zodvex model." The schema building responsibility moves to zodvex.

### What this means for `createSecurityConfig`

hotpot's `createSecurityConfig` derives schemas and rules from models. With the wrapped pattern:
- `model.schema.doc/insert` — from zodvex (via `defineZodModel`)
- `model.rules` — from hotpot wrapper (via `defineHotpotModel`)
- `model.indexes` — from zodvex (via `.index()`)

The combined export is still a single object. `createSecurityConfig` doesn't need to change.

---

## 8. Codegen Implications

With `defineZodModel` being client-safe at the source, the `_generated/zodvex/schema.ts` re-export doesn't need sanitization:

```typescript
// _generated/zodvex/schema.ts (codegen)
export { patients } from '../models/patients'
export { events } from '../models/events'
```

Models are already safe to import from anywhere. The validator registry (`_generated/zodvex/validators.ts`) imports from here and references `patients.schema.doc` directly — live objects with all codecs intact. No `zodToSource()` serialization needed.

---

## 9. Export Structure

| Export | Path | Notes |
|--------|------|-------|
| `defineZodModel` | `zodvex/core` | Client-safe model definition |
| `ZodModel` (type) | `zodvex/core` | For type annotations and framework wrapping |
| `FieldPaths` (type) | `zodvex/core` | For consumers building custom index validation |
| `ModelFieldPaths` (type) | `zodvex/core` | Convenience: `FieldPaths<z.input<T>> \| '_creationTime'` |
| `zodTable` | `zodvex/server` | Unchanged — server-only convenience |
| `defineZodSchema` | `zodvex/server` | Updated to accept both `ZodModel` and `zodTable` results |

---

## 10. Schema Shapes

`defineZodModel` produces the same schema set as `zodTable().schema`:

| Schema | Content | Usage |
|--------|---------|-------|
| `schema.doc` | Fields + `_id` + `_creationTime` | Codec decode target, query return types |
| `schema.insert` | Fields only (no system fields) | Codec encode source, insert arg types |
| `schema.update` | `_id` required + partial fields | Patch operations |
| `schema.docArray` | `z.array(schema.doc)` | List query return types |

System fields:
- `_id: zx.id(tableName)` — branded `GenericId<TableName>` (type-only, no runtime transform)
- `_creationTime: z.number()` — Unix timestamp

---

## 11. Implementation Notes

### Runtime implementation is minimal

`defineZodModel` at runtime is ~20 lines:
1. `z.object(fields)` → insert schema
2. `insertSchema.extend({ _id, _creationTime })` → doc schema
3. `z.array(docSchema)` → docArray
4. Partial fields + `_id` required → update schema
5. Return immutable object with `.index()` method that creates a new model with accumulated indexes

The complexity lives in the types, not the runtime.

### Chainable immutable pattern

Each `.index()` / `.searchIndex()` / `.vectorIndex()` call returns a new model object (not mutation). This is required for TypeScript to track the accumulated indexes in the generic type parameter.

```typescript
// Each call returns a NEW model with updated Indexes type
const m1 = defineZodModel('t', { a: z.string() })           // Indexes = {}
const m2 = m1.index('byA', ['a'])                            // Indexes = { byA: ['a', '_creationTime'] }
const m3 = m2.index('byCreation', ['_creationTime'])          // Indexes = { byA: ..., byCreation: ... }
```

### Union schema support

`zodTable` supports union schemas for polymorphic tables. `defineZodModel` should support the same pattern — accepting a pre-built `z.ZodObject` or `z.ZodUnion` as the second argument. The `FieldPaths` type already handles union distribution correctly (validated in spike).

This is a future enhancement — the initial implementation handles the object shape case, which covers >95% of use cases. Union support follows the same patterns as `zodTable`'s overloads.
