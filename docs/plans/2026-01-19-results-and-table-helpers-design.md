# Result Types and Table Schema Helpers

**Date:** 2026-01-19
**Branch:** `feat/pauls-suggestions`
**Issue:** [#31 - Feature Request: Result Types, Form State Hooks, and Insert/Update Schema Helpers](https://github.com/panzacoder/zodvex/issues/31)

## Overview

This design adds two features to zodvex:

1. **Result types** for explicit error handling in mutations/actions
2. **Table schema helpers** (`schema.insert`, `schema.update`) in `zodTable()`

React hooks (the third feature from issue #31) are deferred to a future `zodvex/react` sub-package.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Result types vs throwing | Parallel systems | Additive, no breaking changes. Users choose per-function. |
| Result type scope | All three types | `MutationResult`, `VoidMutationResult`, `FormResult` are all pure TS |
| Insert/update semantics | Convex-aligned | `insert` = user fields only, `update` = all fields partial |
| Export path for results | Main export | Results are core patterns, not a separate capability like `transform` |
| Schema namespace | `Table.schema.*` | Groups all Zod schemas, extensible, `.schema` (singular) reads better |
| Deprecation strategy | JSDoc + runtime warning | Maximum visibility for consumers |

---

## 1. Result Types

### Types

```typescript
// Core discriminated unions
export type MutationResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export type VoidMutationResult =
  | { success: true }
  | { success: false; error: string };

export type FormResult<TData> =
  | { success: true; data: TData }
  | { success: false; data: TData; error: FormError };

export type FormError = {
  formErrors: string[];
  fieldErrors: Record<string, string[]>;
};
```

### Helper Functions

```typescript
// For MutationResult<T>
export const success = <T>(data: T) => ({ success: true, data }) as const;
export const failure = (error: string) => ({ success: false, error }) as const;

// For VoidMutationResult
export const ok = () => ({ success: true }) as const;

// For FormResult<T>
export const formSuccess = <T>(data: T) => ({ success: true, data }) as const;
export const formFailure = <T>(data: T, error: FormError) =>
  ({ success: false, data, error }) as const;
```

### Zod Schemas for `returns` Validation

```typescript
export const zMutationResult = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.discriminatedUnion("success", [
    z.object({ success: z.literal(true), data: dataSchema }),
    z.object({ success: z.literal(false), error: z.string() }),
  ]);

export const zVoidMutationResult = z.discriminatedUnion("success", [
  z.object({ success: z.literal(true) }),
  z.object({ success: z.literal(false), error: z.string() }),
]);

export const zFormResult = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.discriminatedUnion("success", [
    z.object({ success: z.literal(true), data: dataSchema }),
    z.object({
      success: z.literal(false),
      data: dataSchema,
      error: z.object({
        formErrors: z.array(z.string()),
        fieldErrors: z.record(z.string(), z.array(z.string())),
      }),
    }),
  ]);
```

### Usage Example

```typescript
import { zm } from './util'
import { zVoidMutationResult, ok, failure } from 'zodvex'
import type { VoidMutationResult } from 'zodvex'

export const deleteSpace = zm({
  args: { spaceId: zid("spaces") },
  returns: zVoidMutationResult,
  handler: async (ctx, { spaceId }): Promise<VoidMutationResult> => {
    const space = await ctx.db.get(spaceId);
    if (!space) return failure("Space not found");
    if (space.userId !== ctx.user._id) return failure("Permission denied");

    await ctx.db.delete(spaceId);
    return ok();
  },
});
```

---

## 2. Table Schema Helpers

### New `schema.*` Namespace

`zodTable()` return type gains a `schema` namespace:

```typescript
const Users = zodTable('users', {
  name: z.string(),
  email: z.string().email(),
  age: z.number().optional(),
});

// Existing (now under schema.*)
Users.schema.doc       // ZodObject with _id, _creationTime + user fields
Users.schema.docArray  // ZodArray of doc schema

// New
Users.schema.insert    // ZodObject with user fields only (no system fields)
Users.schema.update    // ZodObject with all user fields made partial
```

### Behavior

```typescript
// schema.insert: user-defined fields only
Users.schema.insert
// → z.object({ name: z.string(), email: z.string().email(), age: z.number().optional() })

// schema.update: all fields partial for patch operations
Users.schema.update
// → z.object({
//     name: z.string().optional(),
//     email: z.string().email().optional(),
//     age: z.number().optional()
//   })
```

### Deprecated Properties

The following properties remain for backwards compatibility but are deprecated:

```typescript
/** @deprecated Use `schema.doc` instead */
Users.zDoc

/** @deprecated Use `schema.docArray` instead */
Users.docArray
```

Accessing deprecated properties triggers a one-time runtime warning:

```
zodvex: `zDoc` is deprecated, use `schema.doc` instead
```

### Union Schema Support

For union/discriminated union schemas, `schema.insert` returns the union without system fields, and `schema.update` applies `.partial()` to each variant. If complexity arises, we can defer `insert`/`update` for unions and only provide `schema.doc`.

---

## 3. File Structure

```
src/
├── results.ts      ← NEW: Result types, helpers, Zod schemas
├── tables.ts       ← MODIFY: Add schema.* namespace, deprecate old properties
├── index.ts        ← MODIFY: Export from results.ts
└── ...
```

### `src/results.ts`

New file containing:
- Type definitions (`MutationResult`, `VoidMutationResult`, `FormResult`, `FormError`)
- Helper functions (`success`, `failure`, `ok`, `formSuccess`, `formFailure`)
- Zod schemas (`zMutationResult`, `zVoidMutationResult`, `zFormResult`)

### `src/tables.ts`

Modifications:
- Add `schema` namespace to return type
- Implement `schema.insert` and `schema.update`
- Add deprecated getters for `zDoc` and `docArray` with runtime warnings
- Keep `shape` at top level (raw input, frequently used)

### `src/index.ts`

Add exports:
```typescript
export * from './results'
```

---

## 4. Documentation Example

For users who need to omit fields populated by the handler (common pattern):

```typescript
// schemas/dancers.ts
import { zodTable, zid } from 'zodvex'
import { z } from 'zod'

const dancerShape = {
  name: z.string(),
  userId: zid('users'),
  createdAt: z.number(),
  bio: z.string().optional(),
}

export const Dancers = zodTable('dancers', dancerShape)

// App-specific input schema: omit fields populated by the handler
export const DancerCreateInput = Dancers.schema.insert.omit({
  userId: true,    // populated from auth context
  createdAt: true  // populated with Date.now()
})

// Usage in mutation
export const create = authMutation({
  args: DancerCreateInput.shape,
  returns: zid('dancers'),
  handler: async (ctx, args) => {
    return ctx.db.insert('dancers', {
      ...args,
      userId: ctx.user._id,       // filled in here
      createdAt: Date.now(),      // filled in here
    })
  },
})
```

This pattern keeps the `.omit()` co-located with the table definition rather than scattered across mutations, making it explicit which fields require handler infill.

---

## 5. Implementation Checklist

- [ ] Create `src/results.ts` with types, helpers, and Zod schemas
- [ ] Update `src/tables.ts`:
  - [ ] Add `schema` namespace to object shape return type
  - [ ] Implement `schema.doc`, `schema.docArray`, `schema.insert`, `schema.update`
  - [ ] Add deprecated getters for `zDoc` and `docArray` with warnings
  - [ ] Handle union schema overload for `schema.*`
- [ ] Update `src/index.ts` to export from `results.ts`
- [ ] Add tests for result types
- [ ] Add tests for new table schema helpers
- [ ] Add tests for deprecation warnings
- [ ] Update README with usage examples

---

## 6. Future Work

- **React hooks** (`useConvexMutationState`, `useConvexActionState`) in `zodvex/react` sub-package
- These hooks will build on the `FormResult` type and integrate with zodvex's error format
