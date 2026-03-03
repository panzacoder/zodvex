# Open Items Design: Pre-Consumer Cleanup

> Three items to close before starting the consumer migration.

**Date:** 2026-02-24
**Branch:** `feat/codec-end-to-end`

---

## 1. Watch mode debouncing (`zodvex dev`)

### Problem

`src/cli/commands.ts` — the `dev()` watcher calls `generate()` immediately on every `fs.watch` event. Rapid file changes (multi-file saves, IDE formatting, git operations) trigger multiple sequential regenerations.

### Design

Add a debounce timer. On each `fs.watch` event, clear the previous timer and set a new 300ms timer. Regenerate only after 300ms of quiet.

```typescript
let debounceTimer: ReturnType<typeof setTimeout> | null = null

const watcher = fs.watch(resolved, { recursive: true }, (_event, filename) => {
  if (!filename) return
  if (filename.startsWith('_zodvex') || filename.startsWith('_generated') ||
      (!filename.endsWith('.ts') && !filename.endsWith('.js'))) return

  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(async () => {
    console.log('[zodvex] Regenerating...')
    try {
      await generate(resolved)
    } catch (err) {
      console.error('[zodvex] Generation failed:', (err as Error).message)
    }
  }, 300)
})
```

**File:** `packages/zodvex/src/cli/commands.ts`
**Scope:** ~10 lines changed in the `dev()` function.

### Test

Manual verification: save multiple files rapidly, confirm only one regeneration fires.

---

## 2. `schema.paginatedDoc` + codegen identity matching

### Problem

Paginated query returns require `returns: zPaginated(TaskModel.schema.doc)`, which the codegen serializes as inline `z.object(...)` with all fields expanded (~15+ fields). The identity is lost because `zPaginated()` creates a new `z.object` — the codegen can't pattern-match it back to the model.

### Design

Two changes:

#### 2a: Add `schema.paginatedDoc` to models

Both `defineZodModel` and `zodTable` gain a `paginatedDoc` schema that matches Convex's `PaginationResult<Doc>` shape:

```typescript
// In model schema namespace:
schema: {
  doc,                // existing — single document
  docArray,           // existing — z.array(doc)
  paginatedDoc,       // NEW — z.object({ page: z.array(doc), isDone, continueCursor })
  base,               // existing — user fields only
  insert,             // existing — alias for base
  update,             // existing — partial user fields + _id
}
```

The `paginatedDoc` schema matches the shape returned by Convex's `query.paginate()`:

```typescript
const paginatedDoc = z.object({
  page: z.array(docSchema),
  isDone: z.boolean(),
  continueCursor: z.string().nullable().optional(),
})
```

User writes `returns: TaskModel.schema.paginatedDoc` instead of `returns: zPaginated(TaskModel.schema.doc)`.

**Files:**
- `packages/zodvex/src/model.ts` — add `paginatedDoc` to `defineZodModel`
- `packages/zodvex/src/tables.ts` — add `paginatedDoc` to `zodTable`
- `packages/zodvex/src/schema.ts` — add `paginatedDoc` to `ZodTableSchemas` type

#### 2b: Codegen identity matching for nested model schemas

The codegen's `resolveSchema()` in `generate.ts` already checks direct identity matches (is the schema exactly `TaskModel.schema.doc`?). Extend this to also match `paginatedDoc`:

Since `paginatedDoc` is now in the model's schema namespace, the identity map (built from model schemas) will include it automatically. When the user writes `returns: TaskModel.schema.paginatedDoc`, the codegen will emit `TaskModel.schema.paginatedDoc` — no inline expansion.

**Files:**
- `packages/zodvex/src/codegen/generate.ts` — include `paginatedDoc` in identity map construction

### Test

- Unit test: `defineZodModel` returns model with `schema.paginatedDoc` that parses correctly
- Unit test: `zodTable` returns table with `schema.paginatedDoc`
- Codegen test: function with `returns: TaskModel.schema.paginatedDoc` emits `TaskModel.schema.paginatedDoc` in registry (not inline)
- Update example app's `tasks:list` to use `TaskModel.schema.paginatedDoc`

---

## 3. `defineZodModel` union schema overload

### Problem

`defineZodModel` only accepts `z.ZodRawShape` (plain object fields). A consumer's visits table uses a discriminated union pattern. Without a union overload, `defineZodModel` can't fully replace `zodTable` for polymorphic tables.

`zodTable()` already has full union support via 3 overloads. `defineZodModel` needs parity.

### Design

Add a second overload that accepts a pre-built schema (`z.ZodObject`, `z.ZodUnion`, or `z.ZodDiscriminatedUnion`):

```typescript
// Overload 1 (existing): raw shape
export function defineZodModel<Name extends string, Fields extends z.ZodRawShape>(
  name: Name,
  fields: Fields
): ZodModel<Name, Fields, z.ZodObject<Fields>, {}, {}, {}>

// Overload 2 (new): pre-built schema
export function defineZodModel<Name extends string, Schema extends z.ZodTypeAny>(
  name: Name,
  schema: Schema
): ZodModel<Name, /* inferred */, Schema, {}, {}, {}>
```

#### Runtime path for unions

Reuse `zodTable()`'s existing union utilities:

1. Detect schema type via `isZodUnion()` / `instanceof z.ZodObject`
2. Extract fields: for objects, use `.shape`; for unions, the raw shape is the union itself
3. Add system fields via `addSystemFields(name, schema)` — already handles union variants
4. Build `insert` (the input schema without system fields), `doc` (with system fields), `update` (partial), `docArray`, `paginatedDoc`

```typescript
// Usage:
const Visits = defineZodModel('visits', z.discriminatedUnion('type', [
  z.object({ type: z.literal('phone'), duration: z.number(), notes: z.string().optional() }),
  z.object({ type: z.literal('in-person'), roomId: z.string(), checkedIn: z.boolean() }),
]))
  .index('byType', ['type'])
  .index('byCreation', ['_creationTime'])
```

#### Type-level considerations

- `FieldPaths` already handles union distribution (validated in spike tests)
- `ModelFieldPaths<InsertSchema>` works for unions because `z.input<z.ZodUnion<[A, B]>>` distributes over A | B
- `.index()` type safety is preserved: field paths are validated against all union variants
- The `Fields` generic param for union models is `z.ZodRawShape` (the union's raw shape is not a plain object shape — use the schema type param instead for type derivation)

#### Schema shapes for unions

Same pattern as `zodTable()` union path:

| Schema | Union handling |
|--------|---------------|
| `insert` | The union schema as-is (user fields only, no system fields) |
| `doc` | System fields added to each variant via `addSystemFields()` |
| `update` | Each variant made partial, `_id` required |
| `docArray` | `z.array(doc)` |
| `paginatedDoc` | `z.object({ page: z.array(doc), isDone, continueCursor })` |

**Files:**
- `packages/zodvex/src/model.ts` — add union overload + runtime detection

### Test

- Type test: `defineZodModel` with discriminated union validates field paths across all variants
- Type test: `.index()` rejects invalid paths, accepts paths from any variant
- Runtime test: `schema.doc` includes system fields on each variant
- Runtime test: `schema.insert` preserves original union without system fields
- Runtime test: `schema.paginatedDoc` wraps union doc correctly
- Runtime test: chainable `.index()` accumulates indexes
- Mirror relevant tests from `zodtable-unions.test.ts`
