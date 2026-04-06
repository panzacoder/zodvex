# Core Type Boundary Enforcement

> Supersedes: `2026-04-06-zod-mini-compat-redesign.md` (which focused on symptoms; this addresses the structural cause)

## Problem

zodvex's shared code freely mixes `z.Zod*` types from full zod with `$Zod*` types from `zod/v4/core`. Since tsc generates `.d.ts` files from source (not built output), any `z.Zod*` reference in shared code produces full-zod type declarations that break mini consumers. There is no rule, lint check, or architectural boundary that makes these violations discoverable.

This has caused 5 iterations of "plan, implement, discover new breakage" on the `feat/memory-management` branch. Each fix addressed the most visible symptom, revealing the next deeper layer of the same structural problem.

### Current error inventory

**Full task-manager** (`examples/task-manager/convex/`): 12 errors in 3 files

| File | Errors | Category |
|---|---|---|
| `cleanup.ts` | 5 | Missing index `by_completed` and field `completedAt` on tasks model |
| `notifications.ts` | 6 | Union model: `.nullable()` on `$ZodType`, `Date` vs `number`, `unknown` doc type |
| `crons.ts` | 1 | `cleanupOld` expects 4 args, gets 3 (cascades from notifications typing) |

**Mini task-manager** (`examples/task-manager-mini/convex/`): 36 errors in 10 files

| File | Errors | Category |
|---|---|---|
| `notifications.ts` | 11 | Union model: same class as full example |
| `tasks.ts` | 7 | `GenericDocument` mismatch — DataModel poisoned by notifications |
| `users.ts` | 4 | Same DataModel poisoning |
| `filters.ts` | 4 | Same DataModel poisoning |
| `activities.ts` | 3 | Same DataModel poisoning |
| `securedTasks.ts` | 2 | Same DataModel poisoning |
| `comments.ts` | 2 | Same DataModel poisoning |
| `functions.ts` | 1 | `initZodvex` overload match fails due to poisoned DataModel |
| `crons.ts` | 1 | Same as full example |
| `api/reports.ts` | 1 | Same DataModel poisoning |

### Root cause analysis

The errors have two independent causes:

**Cause A: Union model types are untyped.** `defineZodModel` overload 2 (union/discriminated union) returns `ModelSchemas` — the base constraint where every schema property is `$ZodType`. This means `model.schema.doc` is `$ZodType` (no shape info, no methods like `.nullable()`), and `ConvexTableFor` falls through to bare `TableDefinition` (no field types). The notifications union model produces `sentAt: Date` in the document type (decoded type instead of wire type), which makes the DataModel fail Convex's `GenericDataModel` constraint.

This single failure **poisons the entire DataModel** — Convex rejects the whole schema, causing `initZodvex` to fall back to `GenericDataModel` for ALL tables. That's why 25 of the 36 mini errors are in non-notification files.

**Cause B: Shared types use `z.Zod*` instead of `$Zod*`, and mini `zx` types widen away brands.** `ZodvexCodec` uses `z.ZodCodec`, `ZxDate` uses `z.ZodNumber`/`z.ZodCustom`, and `ZxMiniDate` widens to `$ZodType<Date>` (losing the `ZodvexWireSchema` brand). These cause `createdAt: "required"` in the mapping layer. However, this is currently **masked** by Cause A's DataModel poisoning — the errors you'd see from Cause B alone are hidden behind the generic fallback.

**Cause C: Example import paths.** The mini example imports `defineZodSchema` from `'zodvex'` (full-zod root) and `initZodvex` from `'zodvex/server'` instead of `'zodvex/mini/server'`.

**Cause D: Pre-existing example issues.** `cleanup.ts` references index `by_completed` and field `completedAt` that don't exist on the tasks model (the model has `by_created`/`createdAt` but the unstaged WIP adds `by_completed`/`completedAt`). `crons.ts` calls `crons.daily()` with wrong arity.

## Design

### Fix 1: Convert shared types to `$Zod*` and fix mini brand widening

This is independently verifiable on non-union tables even while the DataModel is poisoned — the type resolution of individual fields can be tested directly.

**In `types.ts`:** `ZodvexCodec` → use `$ZodCodec` from `zod/v4/core`.

**In `zx.ts`:** `ZxDate` → use `$ZodNumber`, `$ZodCustom` from core. `ZxId` → use `$ZodType` from core.

**In `mini/index.ts`:** `ZxMiniDate` → `ZodvexCodec<$ZodNumber, $ZodCustom<Date, Date>>` (preserves the `ZodvexWireSchema` brand that the mapping layer needs).

Add missing imports (`$ZodCodec`, `$ZodCustom`, `$ZodNumber`) to `zod-core.ts` exports if not already present.

**Verified:** these changes pass zodvex's own `bun run type-check`, and a diagnostic test confirms `ConvexValidatorFromZod<ZxMiniDate>` correctly resolves to `VFloat64<number, 'required'>`.

### Fix 2: Union model type computation

Two sub-parts:

**2a: Preserve union Schema type through the model.**

Add `UnionModelSchemas<Schema>` that preserves the specific union type in ALL consumer-facing positions, not just `base`/`insert`:

```ts
export type UnionModelSchemas<
  Name extends string,
  Schema extends $ZodType
> = {
  readonly doc: AddSystemFieldsResult<Name, Schema>  // computed union with system fields
  readonly base: Schema
  readonly insert: Schema
  readonly update: $ZodType  // partial union — hard to type precisely, $ZodType is acceptable
  readonly docArray: $ZodArray<AddSystemFieldsResult<Name, Schema>>
  readonly paginatedDoc: $ZodType  // compound type, $ZodType acceptable
}
```

`AddSystemFieldsResult` is the existing type in `schemaHelpers.ts` that computes the union-with-system-fields type. Using it here ensures `schema.doc` has the correct discriminated union shape with `_id` and `_creationTime` — not bare `$ZodType`.

This preserves:
- `schema.doc` — consumers can call `.nullable()` (full zod) or use `z.nullable(schema.doc)` (mini), and type inference extracts the discriminated union shape
- `schema.base` / `schema.insert` — the raw union for ConvexTableFor
- `schema.docArray` — typed array of the union doc

Update overload 2 in both `model.ts` and `mini/index.ts` to return `UnionModelSchemas<Name, Schema>`.

**2b: Add union branch to ConvexTableFor.**

In `schema.ts`, `ConvexTableFor` checks `schema.base extends $ZodUnion | $ZodDiscriminatedUnion` and computes the Convex validator from the union schema using `ConvexValidatorFromZod<Base>` instead of from empty fields.

### Fix 3: Fix example import paths and pre-existing issues

**Mini example imports:**
- `schema.ts`: `'zodvex'` → `'zodvex/mini/server'`
- `functions.ts`: `'zodvex/server'` → `'zodvex/mini/server'`

**Full example pre-existing issues:**
- `cleanup.ts`: either add the missing `by_completed` index to the tasks model, or update cleanup.ts to use existing indexes
- `crons.ts`: fix the `crons.daily()` call arity
- `notifications.ts`: remaining errors should be resolved by Fix 2, but if `.nullable()` on union doc schema still fails, the example code needs to use `z.nullable(NotificationModel.schema.doc)` (functional form)

### Fix 4: Add example type-check to CI

Add to project scripts:

```json
"type-check:examples": "tsc --noEmit -p examples/task-manager/convex/tsconfig.json && tsc --noEmit -p examples/task-manager-mini/convex/tsconfig.json"
```

Note: the Convex-specific tsconfig is at `examples/<name>/convex/tsconfig.json` (inside `convex/`, not at the example root).

### Fix 5: Lint rule to prevent regression

Grep-based check that flags `z.Zod` references in shared code:

```json
"lint:core-types": "! grep -rn 'z\\.Zod[A-Z]' src/ --include='*.ts' --exclude-dir=mini --exclude-dir=core --exclude=tables.ts --exclude-dir=form | grep -v '// zod-ok' | grep -v 'import type'"
```

Files that legitimately need `z.Zod*` (like `FullZodModelSchemas` in model.ts) get a `// zod-ok` comment.

## Verification

After all fixes:

1. `bun run type-check` — zero errors
2. `bun run test` — all tests pass
3. `tsc --noEmit -p examples/task-manager/convex/tsconfig.json` — zero errors
4. `tsc --noEmit -p examples/task-manager-mini/convex/tsconfig.json` — zero errors
5. `bun run lint:core-types` — zero violations
6. `bun run build` — clean, mini outputs have no bare `'zod'` imports

## Order of implementation

1. Fix 1 (shared types to `$Zod*` + mini brand) — independently verifiable, unblocks correct field type resolution
2. Fix 2 (union model types + ConvexTableFor) — unblocks the DataModel, most complex
3. Fix 3 (example imports + pre-existing fixes) — depends on fixes 1-2 being in place to verify
4. Fix 4 (CI gate) — depends on fix 3 (examples must type-check clean first)
5. Fix 5 (lint rule) — independent, can be done anytime

Fixes 1 and 2 can be done in parallel. Fix 1 is mechanical (~3 files). Fix 2 requires type-level design for `UnionModelSchemas` and `ConvexTableFor`.
