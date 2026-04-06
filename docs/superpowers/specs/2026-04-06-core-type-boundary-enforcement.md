# Core Type Boundary Enforcement

> Supersedes: `2026-04-06-zod-mini-compat-redesign.md` (which focused on symptoms; this addresses the structural cause)

## Problem

zodvex's shared code freely mixes `z.Zod*` types from full zod with `$Zod*` types from `zod/v4/core`. Since tsc generates `.d.ts` files from source (not built output), any `z.Zod*` reference in shared code produces full-zod type declarations that break mini consumers. There is no rule, lint check, or architectural boundary that makes these violations discoverable.

This has caused 5 iterations of "plan, implement, discover new breakage" on the `feat/memory-management` branch. Each fix addressed the most visible symptom, revealing the next deeper layer of the same structural problem.

### The three problems (in dependency order)

**Problem 3 (poisons everything): Union model `ConvexTableFor` produces `Date` instead of wire types.**

The notifications discriminated union model produces `sentAt: Date` in its Convex document type. `Date` is the decoded (runtime) type from `zx.date()`, but Convex's `Value` type requires wire types (`number`). This single table makes the entire `DataModel` fail Convex's `GenericDataModel` constraint, causing `initZodvex` to fall back to `GenericDataModel` for ALL tables. All 36 type errors in task-manager-mini cascade from this.

Root cause: `ConvexTableFor` in `schema.ts` doesn't handle union models — it falls through to `TableDefinition` (untyped). The reverted union fix attempt tried to use `ConvexValidatorFromZod<Base>` on the union schema, but the union variants contain codec fields (`zx.date()`) whose `WireInfer` type resolves to `Date` instead of `number` in the union context.

**Problem 1: Shared types use `z.Zod*` instead of `$Zod*`.**

| Type | File | Current | Should be |
|---|---|---|---|
| `ZodvexCodec<W,R>` | `types.ts:118` | `z.ZodCodec<W,R> & brand` | `$ZodCodec<W,R> & brand` |
| `ZxDate` | `zx.ts:33` | `ZodvexCodec<z.ZodNumber, z.ZodCustom<Date>>` | `ZodvexCodec<$ZodNumber, $ZodCustom<Date>>` |
| `ZxId<T>` | `zx.ts:65` | `z.ZodType<GenericId<T>> & brand` | `$ZodType<GenericId<T>> & brand` |

Verified: changing these to core types passes zodvex's own type-check and the mapping layer correctly resolves `ZxMiniDate` → `VFloat64<number, 'required'>`.

**Problem 2: Mini `zx` types widen to `$ZodType`, losing the `ZodvexWireSchema` brand.**

| Type | File | Current | Should be |
|---|---|---|---|
| `ZxMiniDate` | `mini/index.ts:153` | `$ZodType<Date>` | `ZodvexCodec<$ZodNumber, $ZodCustom<Date>>` |

When `ZxMiniDate` is `$ZodType<Date>`, the mapping layer's first check (`Z extends { [ZodvexWireSchema]: infer W }`) can't find the brand → falls through to `VAny<'required'>` → produces `createdAt: "required"`.

### Additional issues

**Example import paths are wrong.** `task-manager-mini/convex/schema.ts` imports from `'zodvex'` (full-zod root) and `functions.ts` from `'zodvex/server'`. Must use `'zodvex/mini/server'` for both.

**No CI gate on example type-checks.** The mini example has had type errors throughout this branch with no automated process catching them.

## Design

### Fix 1: Union model type computation in ConvexTableFor

`ConvexTableFor` in `schema.ts` needs a union model branch. The runtime already handles this:

```ts
// schema.ts runtime (already correct)
const isUnionModel = Object.keys(model.fields).length === 0
let table = isUnionModel
  ? defineTable(zodToConvex(model.schema.base) as any)
  : defineTable(zodToConvexFields(model.fields))
```

The type-level equivalent must:
1. Detect union models (the model's `InsertSchema` — carried in overload 2's return type — extends `$ZodUnion` or `$ZodDiscriminatedUnion`)
2. Compute the Convex validator from the union schema using `ConvexValidatorFromZod<Schema>`
3. Ensure codec fields in union variants produce wire types (number, not Date)

This requires `defineZodModel` overload 2 to carry the specific `Schema` type through the model's type parameters so `ConvexTableFor` can access it. Currently overload 2 returns `ModelSchemas` (base constraint with `$ZodType` everywhere), losing the union type.

**Approach:** Add `UnionModelSchemas<Schema>` that preserves the specific union type in `base`:

```ts
export type UnionModelSchemas<Schema extends $ZodType> = {
  readonly doc: $ZodType
  readonly base: Schema    // ← preserves the union type
  readonly insert: Schema
  readonly update: $ZodType
  readonly docArray: $ZodType
  readonly paginatedDoc: $ZodType
}
```

Update overload 2 in both `model.ts` and `mini/index.ts` to return `UnionModelSchemas<Schema>`.

Update `ConvexTableFor` to check `Base extends $ZodUnion | $ZodDiscriminatedUnion` and compute accordingly.

### Fix 2: Convert shared types to `$Zod*`

In `types.ts`: `ZodvexCodec` → use `$ZodCodec` from core.

In `zx.ts`: `ZxDate` → use `$ZodNumber`, `$ZodCustom`. `ZxId` → use `$ZodType`.

In `mini/index.ts`: `ZxMiniDate` → use `ZodvexCodec<$ZodNumber, $ZodCustom<Date, Date>>` (preserves brand).

Add missing imports (`$ZodCodec`, `$ZodCustom`, `$ZodNumber`) to `zod-core.ts` if not already exported.

### Fix 3: Fix example import paths

In `task-manager-mini/convex/schema.ts`: `'zodvex'` → `'zodvex/mini/server'`
In `task-manager-mini/convex/functions.ts`: `'zodvex/server'` → `'zodvex/mini/server'`

### Fix 4: Add example type-check to CI

Add to the project scripts or CI workflow:

```bash
tsc --noEmit -p examples/task-manager/convex/tsconfig.json
tsc --noEmit -p examples/task-manager-mini/convex/tsconfig.json
```

### Fix 5: Lint rule to prevent regression

Add a biome/grep-based check that flags `z.Zod` references in shared code. Shared code = everything in `src/` except `src/mini/`, `src/core/`, `src/tables.ts`, and `src/form/`. The rule: `import type { z } from 'zod'` is fine (erased at compile time), but `z.ZodFoo` in type positions in shared modules is a violation.

This can be as simple as a script in `package.json`:

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

1. Fix 1 (union ConvexTableFor) — unblocks the DataModel, most complex
2. Fix 2 (shared types to core) — mechanical, ~3 files
3. Fix 3 (example imports) — trivial, 2 files
4. Fix 4 (CI gate) — trivial, prevents regression
5. Fix 5 (lint rule) — prevents future violations

Fixes 2-5 are independent of each other. Fix 1 must come first because without it, the DataModel is poisoned and fixes 2-3 can't be verified.
