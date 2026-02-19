# Codec DB Primitives Design

> DB-level codec wrapping for zodvex — boundaries 5 (DB read) and 6 (DB write).
> Builds on the v2 distilled design. Scope: primitives and wrappers only, no `initZodvex`.

---

## 1. Primitives: `decodeDoc` / `encodeDoc`

Lowest-level building blocks. Standalone functions for consumers building custom DB layers.

```typescript
function decodeDoc<S extends z.ZodTypeAny>(schema: S, wireDoc: unknown): z.output<S>
function encodeDoc<S extends z.ZodTypeAny>(schema: S, runtimeDoc: z.output<S>): z.input<S>
function encodePartialDoc<S extends z.ZodTypeAny>(schema: S, partial: Partial<z.output<S>>): Partial<z.input<S>>
```

- `decodeDoc` — `schema.parse(wireDoc)` (runs codec decode transforms)
- `encodeDoc` — `stripUndefined(z.encode(schema, runtimeDoc))` (runs codec encode, strips undefined for Convex)
- `encodePartialDoc` — uses `schema.partial()` + `z.encode()` to encode only present fields in a patch value. If Zod's `.partial()` + `z.encode()` doesn't handle absent fields correctly, fall back to field-by-field encoding.

---

## 2. ZodTableMap + `defineZodSchema`

The DB wrapper needs to look up a table's Zod schema by name at runtime.

### `ZodTableSchemas` / `ZodTableMap`

```typescript
type ZodTableSchemas = {
  doc: z.ZodTypeAny      // Full doc with system fields (_id, _creationTime) — for decode
  docArray: z.ZodTypeAny // Array of docs
  base: z.ZodTypeAny     // User fields only (no system fields)
  insert: z.ZodTypeAny   // Alias for base — for insert/replace encode
  update: z.ZodTypeAny   // Partial user fields + _id — for update validation
}

type ZodTableMap = Record<string, ZodTableSchemas>
// Maps table name → full zodTable().schema set
```

### `defineZodSchema`

Wraps Convex's `defineSchema()` and attaches the zodTableMap to the return value:

```typescript
function defineZodSchema(
  tables: Record<string, { table: any; schema: ZodTableSchemas }>
): ReturnType<typeof defineSchema> & { __zodTableMap: ZodTableMap }
```

Usage:

```typescript
// convex/schema.ts
export default defineZodSchema({
  users: Users,   // zodTable() results
  posts: Posts,
})

// The default export is a valid Convex schema AND carries __zodTableMap
// import schema from './schema' => schema.__zodTableMap
```

The double-underscore signals internal/framework use. Consumers pass the schema object to factory functions; they don't interact with `__zodTableMap` directly.

---

## 3. `CodecDatabaseReader`

Class implementing `GenericDatabaseReader<DataModel>`. Intercepts every read to decode through the table's Zod schema. `GenericDatabaseReader` is an interface (not a class), so we must implement it — same pattern as convex-helpers' `WrapReader`.

```typescript
class CodecDatabaseReader<DataModel extends GenericDataModel>
  implements GenericDatabaseReader<DataModel>
{
  constructor(
    private db: GenericDatabaseReader<DataModel>,
    private tableMap: ZodTableMap,
  ) {}

  system = this.db.system  // pass-through, no codec on system tables

  normalizeId(tableName, id) → pass-through

  get(idOrTable, maybeId?) {
    // Handle both overloads: get(id) and get(table, id)
    // Resolve table name from args (for get(id), iterate tableMap + normalizeId)
    // Decode result through table's doc schema
    // Pass-through if table not in zodTableMap
  }

  query(tableName) {
    // If table in zodTableMap: wrap with CodecQueryChain
    // Otherwise: pass-through
  }
}
```

### Key decisions

- **Pass-through for unknown tables** — tables not in the zodTableMap get no decoding. Allows mixing zodvex tables with plain Convex tables.
- **`system` is pass-through** — system tables don't have Zod schemas.
- **Table name resolution for `get(id)`** — iterate zodTableMap keys, call `normalizeId` for each. Same approach as convex-helpers' RLS wrapper.

---

## 4. `CodecQueryChain`

Single class wrapping the full Convex query chain. Implements `QueryInitializer<TableInfo>` (the broadest interface).

Decoding happens only at terminal methods. Intermediate methods pass through to the inner query — filter expressions run server-side against wire-format data.

### Terminal methods (decode at boundary)

- `first()` — decode single doc or null
- `unique()` — decode single doc or null
- `collect()` — decode each doc in array
- `take(n)` — decode each doc in array
- `paginate(opts)` — decode each doc in `page` array of PaginationResult

### Intermediate methods (pass-through, return wrapped)

- `fullTableScan()` → new CodecQueryChain wrapping result
- `withIndex(name, range?)` → new CodecQueryChain wrapping result
- `withSearchIndex(name, filter)` → new CodecQueryChain wrapping result
- `order(order)` → new CodecQueryChain wrapping result
- `filter(predicate)` → new CodecQueryChain wrapping result

### AsyncIterable

`CodecQueryChain` must also implement `AsyncIterable` (since `OrderedQuery extends AsyncIterable`). The async iterator decodes each yielded document.

---

## 5. `CodecDatabaseWriter`

Class implementing `GenericDatabaseWriter<DataModel>`. Extends the reader pattern with write methods. Delegates reads to an internal `CodecDatabaseReader`.

```typescript
class CodecDatabaseWriter<DataModel extends GenericDataModel>
  implements GenericDatabaseWriter<DataModel>
{
  private reader: CodecDatabaseReader<DataModel>

  constructor(
    private db: GenericDatabaseWriter<DataModel>,
    private tableMap: ZodTableMap,
  ) {
    this.reader = new CodecDatabaseReader(db, tableMap)
  }

  // Reads delegate to reader
  system, get, query, normalizeId → this.reader.*

  // Writes encode before delegating (using schemas.insert — user fields only)
  insert(table, value) → encodeDoc(schemas.insert) then db.insert
  patch(id/table, value) → encodePartialDoc(schemas.insert) then db.patch
  replace(id/table, value) → encodeDoc(schemas.insert) then db.replace
  delete(id/table) → pass-through (no data to encode)
}
```

### Write method overloads

Convex write methods have two forms: `(table, id, value)` and `(id, value)`. For the short form, table name resolution uses the same `normalizeId` iteration as `get(id)`.

### `patch()` partial encoding

Uses `encodePartialDoc` — creates a partial schema via `schema.partial()`, then runs `z.encode()`. Only present fields are encoded. Start with this approach; fall back to field-by-field if Zod's behavior doesn't cooperate.

---

## 6. Factory Functions

Public-facing constructors. Extract the table map and instantiate the classes.

```typescript
function createZodDbReader<DataModel extends GenericDataModel>(
  db: GenericDatabaseReader<DataModel>,
  schema: { __zodTableMap: ZodTableMap },
): CodecDatabaseReader<DataModel>

function createZodDbWriter<DataModel extends GenericDataModel>(
  db: GenericDatabaseWriter<DataModel>,
  schema: { __zodTableMap: ZodTableMap },
): CodecDatabaseWriter<DataModel>
```

The second arg accepts anything with `__zodTableMap` — so you can pass the `defineZodSchema()` result directly, or a raw `{ __zodTableMap: map }` object for testing.

Usage in a customization:

```typescript
const myQuery = zCustomQuery(query, {
  args: {},
  input: async (ctx) => {
    const db = createZodDbReader(ctx.db, schema)
    return { ctx: { db }, args: {} }
  },
})
```

---

## 7. Export Structure

| Export | Path |
|---|---|
| `decodeDoc`, `encodeDoc`, `encodePartialDoc` | `zodvex/core` (client-safe primitives) |
| `ZodTableMap`, `ZodTableSchemas` types | `zodvex/core` |
| `defineZodSchema` | `zodvex/server` (imports `defineSchema` from convex/server) |
| `CodecDatabaseReader`, `CodecDatabaseWriter` | `zodvex/server` |
| `CodecQueryChain` | `zodvex/server` |
| `createZodDbReader`, `createZodDbWriter` | `zodvex/server` |

---

## 8. File Organization

- `src/codec.ts` — add `decodeDoc`, `encodeDoc`, `encodePartialDoc` (alongside existing `convexCodec`)
- `src/db.ts` — new file: `CodecDatabaseReader`, `CodecDatabaseWriter`, `CodecQueryChain`, factory functions
- `src/schema.ts` — new file: `defineZodSchema`, `ZodTableMap` type
- Update `src/core/index.ts` and `src/server/index.ts` for new exports
