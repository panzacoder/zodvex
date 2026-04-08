# Core Type Boundary Enforcement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce `$Zod*` core types in shared zodvex code, fix union model type computation, and add CI gates so mini compat regressions are caught immediately.

**Architecture:** Three layers of fix: (1) convert shared type references from `z.Zod*` to `$Zod*` and fix mini brand widening, (2) add `AddSystemFieldsToUnion` core-compatible type helper and `UnionModelSchemas` to preserve union schema types through the model pipeline, (3) fix example app issues and add CI gates. The build-time esbuild alias already handles runtime; these are all type-declaration fixes.

**Tech Stack:** TypeScript, zod v4 / zod/v4/core, Convex, tsup, vitest, biome

**Spec:** `docs/superpowers/specs/2026-04-06-core-type-boundary-enforcement.md`

**Script locations:** `type-check:examples` and `lint:core-types` go in the **root** `package.json` (not `packages/zodvex/package.json`) because they operate across workspaces. All other scripts stay in `packages/zodvex/package.json`.

---

### Task 1: Convert `ZodvexCodec`, `ZxDate`, `ZxId` to core types

The most impactful and independently verifiable fix. Changes 3 zodvex source files to use `$Zod*` from `zod/v4/core` instead of `z.Zod*` from full zod. Also fixes `ZxMiniDate` to preserve the `ZodvexWireSchema` brand.

**Files:**
- Modify: `packages/zodvex/src/types.ts:118`
- Modify: `packages/zodvex/src/zx.ts:28,33,65`
- Modify: `packages/zodvex/src/mini/index.ts:144,153`
- Test: `packages/zodvex/__tests__/mini-codec-resolve.test.ts` (create)

- [ ] **Step 1: Write the diagnostic type test**

Create `packages/zodvex/__tests__/mini-codec-resolve.test.ts`:

```ts
/**
 * Verifies that ConvexValidatorFromZod resolves ZxMiniDate correctly.
 * If this fails, the mapping layer can't extract wire types from codec fields.
 */
import { describe, expectTypeOf, it } from 'vitest'
import type { VFloat64 } from 'convex/values'
import type { ZxMiniDate } from '../src/mini'
import type { ZxDate } from '../src/zx'
import type { ConvexValidatorFromZod } from '../src/mapping/types'

describe('codec type resolution', () => {
  it('ZxDate (full) resolves to VFloat64', () => {
    type Result = ConvexValidatorFromZod<ZxDate, 'required'>
    expectTypeOf<Result>().toMatchTypeOf<VFloat64<number, 'required'>>()
  })

  it('ZxMiniDate resolves to VFloat64', () => {
    type Result = ConvexValidatorFromZod<ZxMiniDate, 'required'>
    expectTypeOf<Result>().toMatchTypeOf<VFloat64<number, 'required'>>()
  })
})
```

- [ ] **Step 2: Run the test to see it fail**

Run: `bun run test -- __tests__/mini-codec-resolve.test.ts`

Expected: The `ZxDate` test passes (full zod types match). The `ZxMiniDate` test **fails** because `ZxMiniDate = $ZodType<Date>` has no `ZodvexWireSchema` brand, so the mapping falls through to `VAny<'required'>`.

- [ ] **Step 3: Fix `ZodvexCodec` in types.ts**

In `packages/zodvex/src/types.ts`, change the import on line 9 and the type on line 118:

Change line 9 from:
```ts
import type { $ZodType, infer as zinfer, output as zoutput } from 'zod/v4/core'
```
to:
```ts
import type { $ZodCodec, $ZodType, infer as zinfer, output as zoutput } from 'zod/v4/core'
```

Change lines 118-123 from:
```ts
export type ZodvexCodec<Wire extends $ZodType, Runtime extends $ZodType> = z.ZodCodec<
  Wire,
  Runtime
> & {
  readonly [ZodvexWireSchema]: Wire
}
```
to:
```ts
export type ZodvexCodec<Wire extends $ZodType, Runtime extends $ZodType> = $ZodCodec<
  Wire,
  Runtime
> & {
  readonly [ZodvexWireSchema]: Wire
}
```

- [ ] **Step 4: Fix `ZxDate` and `ZxId` in zx.ts**

In `packages/zodvex/src/zx.ts`, change the import on line 28:

From:
```ts
import { type $ZodType, type output as zoutput } from './zod-core'
```
to:
```ts
import { type $ZodCustom, type $ZodNumber, type $ZodType, type output as zoutput } from './zod-core'
```

Change line 33 from:
```ts
export type ZxDate = ZodvexCodec<z.ZodNumber, z.ZodCustom<Date, Date>>
```
to:
```ts
export type ZxDate = ZodvexCodec<$ZodNumber, $ZodCustom<Date, Date>>
```

Change lines 65-67 from:
```ts
export type ZxId<TableName extends string> = z.ZodType<GenericId<TableName>> & {
  _tableName: TableName
}
```
to:
```ts
export type ZxId<TableName extends string> = $ZodType<GenericId<TableName>> & {
  _tableName: TableName
}
```

- [ ] **Step 5: Fix `ZxMiniDate` in mini/index.ts**

In `packages/zodvex/src/mini/index.ts`, change the import on line 144:

From:
```ts
import type { $ZodCodec, $ZodType } from '../zod-core'
```
to:
```ts
import type { $ZodCodec, $ZodCustom, $ZodType } from '../zod-core'
```

Note: `$ZodNumber` is already imported on line 78 via the earlier import block. Do NOT add a duplicate.

Change line 153 from:
```ts
export type ZxMiniDate = $ZodType<Date>
```
to:
```ts
export type ZxMiniDate = ZodvexCodec<$ZodNumber, $ZodCustom<Date, Date>>
```

- [ ] **Step 6: Run tests**

Run: `bun run type-check && bun run test -- __tests__/mini-codec-resolve.test.ts`

Expected: type-check clean, both `ZxDate` and `ZxMiniDate` tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/zodvex/src/types.ts packages/zodvex/src/zx.ts packages/zodvex/src/mini/index.ts packages/zodvex/__tests__/mini-codec-resolve.test.ts
git commit -m "fix: use core types for ZodvexCodec, ZxDate, ZxId, ZxMiniDate

Replace z.ZodCodec/z.ZodNumber/z.ZodCustom/z.ZodType with \$Zod*
equivalents from zod/v4/core. Preserve ZodvexWireSchema brand in
ZxMiniDate so the mapping layer can extract wire types."
```

---

### Task 2: Create `AddSystemFieldsToUnion` core-compatible type

The existing `AddSystemFieldsResult` in `tables.ts:173` uses `z.Zod*` terms and is private. We need a core-compatible version in `schemaHelpers.ts` for use by `UnionModelSchemas`.

**Files:**
- Modify: `packages/zodvex/src/schemaHelpers.ts:31-44`
- Test: `packages/zodvex/__tests__/union-model-types.test.ts` (create)

- [ ] **Step 1: Write the type test for AddSystemFieldsToUnion**

Create `packages/zodvex/__tests__/union-model-types.test.ts`:

```ts
/**
 * Type tests for union model schema computation.
 * Verifies AddSystemFieldsToUnion produces the right types for
 * object, union, and discriminated union schemas.
 */
import { describe, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import type { $ZodObject, $ZodDiscriminatedUnion, $ZodNumber, $ZodString } from 'zod/v4/core'
import type { AddSystemFieldsToUnion, SystemFields } from '../src/schemaHelpers'

describe('AddSystemFieldsToUnion', () => {
  it('preserves $ZodObject and adds system fields', () => {
    type Input = $ZodObject<{ name: $ZodString }>
    type Result = AddSystemFieldsToUnion<'test', Input>
    // Result should be a $ZodObject with name + _id + _creationTime
    expectTypeOf<Result>().toMatchTypeOf<$ZodObject<{ name: $ZodString } & SystemFields<'test'>>>()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- __tests__/union-model-types.test.ts`
Expected: FAIL — `AddSystemFieldsToUnion` doesn't exist yet.

- [ ] **Step 3: Add SystemFields with core types and AddSystemFieldsToUnion**

In `packages/zodvex/src/schemaHelpers.ts`, the existing `SystemFields` on line 31 uses `z.ZodNumber`. Change it to use `$ZodNumber`:

First add `$ZodNumber` to the import on line 14:

Change:
```ts
import {
  $ZodDiscriminatedUnion,
  $ZodObject,
  type $ZodShape,
  $ZodType,
  $ZodUnion,
  clone
} from './zod-core'
```
to:
```ts
import {
  $ZodArray,
  $ZodDiscriminatedUnion,
  $ZodNumber,
  $ZodObject,
  type $ZodShape,
  $ZodType,
  $ZodUnion,
  clone
} from './zod-core'
```

Change lines 31-34 from:
```ts
export type SystemFields<TableName extends string> = {
  _id: ZxId<TableName>
  _creationTime: z.ZodNumber
}
```
to:
```ts
export type SystemFields<TableName extends string> = {
  _id: ZxId<TableName>
  _creationTime: $ZodNumber
}
```

Then add `MapSystemFieldsCore` and `AddSystemFieldsToUnion` after line 44 (after `MapSystemFields`):

```ts
/**
 * Core-compatible version of MapSystemFields.
 * Uses $ZodObject from zod/v4/core instead of z.ZodObject from full zod.
 */
export type MapSystemFieldsCore<TableName extends string, Options extends readonly $ZodType[]> = {
  [K in keyof Options]: Options[K] extends $ZodObject<infer Shape extends $ZodShape>
    ? $ZodObject<Shape & SystemFields<TableName>>
    : Options[K]
}

/**
 * Computes the result of adding system fields to a union/object schema.
 * Uses only $Zod* types from zod/v4/core — safe for shared code and mini consumers.
 *
 * Handles:
 * - $ZodObject → $ZodObject with system fields
 * - $ZodUnion → $ZodUnion with system fields on each variant
 * - $ZodDiscriminatedUnion → $ZodDiscriminatedUnion with system fields on each variant
 * - Other → returned as-is
 */
export type AddSystemFieldsToUnion<TableName extends string, Schema extends $ZodType> =
  Schema extends $ZodObject<infer Shape extends $ZodShape>
    ? $ZodObject<Shape & SystemFields<TableName>>
    : Schema extends $ZodUnion<infer Options extends readonly $ZodType[]>
      ? $ZodUnion<MapSystemFieldsCore<TableName, Options>>
      : Schema extends $ZodDiscriminatedUnion<infer Options extends readonly $ZodType[], infer Disc extends string>
        ? $ZodDiscriminatedUnion<MapSystemFieldsCore<TableName, Options>, Disc>
        : Schema
```

- [ ] **Step 4: Run tests**

Run: `bun run type-check && bun run test -- __tests__/union-model-types.test.ts`
Expected: type-check clean, test passes.

- [ ] **Step 5: Commit**

```bash
git add packages/zodvex/src/schemaHelpers.ts packages/zodvex/__tests__/union-model-types.test.ts
git commit -m "feat: add AddSystemFieldsToUnion core-compatible type helper

Core-typed equivalent of tables.ts AddSystemFieldsResult. Uses \$Zod*
from zod/v4/core instead of z.Zod* from full zod. Handles object,
union, and discriminated union schemas."
```

---

### Task 3: Add `UnionModelSchemas` and update overload 2

Wire `AddSystemFieldsToUnion` into a new `UnionModelSchemas` type and update `defineZodModel` overload 2 in both `model.ts` and `mini/index.ts`.

**Files:**
- Modify: `packages/zodvex/src/model.ts:95-102,241-246`
- Modify: `packages/zodvex/src/mini/index.ts:118-122`

- [ ] **Step 1: Add UnionModelSchemas to model.ts**

In `packages/zodvex/src/model.ts`, add to the imports from `./schemaHelpers` (around line 14):

Add `AddSystemFieldsToUnion` to the existing import:

```ts
import {
  addSystemFields,
  type AddSystemFieldsToUnion,
  createUnionFromOptions,
  getUnionOptions,
  isZodUnion
} from './schemaHelpers'
```

Add `$ZodArray` to the import from `./zod-core` if not already present.

Then add after `ModelSchemas` (after line 102):

```ts
/**
 * Schema types for union/discriminated union models.
 * Preserves the specific Schema type so ConvexTableFor can compute
 * validators from the union, and consumers get typed schema.doc access.
 */
export type UnionModelSchemas<Name extends string, Schema extends $ZodType> = {
  readonly doc: AddSystemFieldsToUnion<Name, Schema>
  readonly base: Schema
  readonly insert: Schema
  readonly update: $ZodType
  readonly docArray: $ZodArray<AddSystemFieldsToUnion<Name, Schema>>
  readonly paginatedDoc: $ZodType
}
```

- [ ] **Step 2: Update overload 2 in model.ts**

Change lines 242-246 from:

```ts
export function defineZodModel<Name extends string, Schema extends $ZodType>(
  name: Name,
  schema: Schema
  // biome-ignore lint/complexity/noBannedTypes: {} is intentional — represents zero indexes/searchIndexes/vectorIndexes
): ZodModel<Name, $ZodShape, Schema, ModelSchemas, {}, {}, {}>
```

to:

```ts
export function defineZodModel<Name extends string, Schema extends $ZodType>(
  name: Name,
  schema: Schema
  // biome-ignore lint/complexity/noBannedTypes: {} is intentional — represents zero indexes/searchIndexes/vectorIndexes
): ZodModel<Name, $ZodShape, Schema, UnionModelSchemas<Name, Schema>, {}, {}, {}>
```

- [ ] **Step 3: Update overload 2 in mini/index.ts**

In `packages/zodvex/src/mini/index.ts`, add `UnionModelSchemas` to the import from `'../model'` (around line 69):

```ts
import {
  defineZodModel as _defineZodModel,
  type ModelSchemas as _ModelSchemas,
  type UnionModelSchemas as _UnionModelSchemas,
  type ZodModel as _ZodModel
} from '../model'
```

Change lines 118-122 from:

```ts
  <Name extends string, Schema extends $ZodType>(
    name: Name,
    schema: Schema
    // biome-ignore lint/complexity/noBannedTypes: {} is intentional — represents zero indexes/searchIndexes/vectorIndexes
  ): _ZodModel<Name, $ZodShape, Schema, _ModelSchemas, {}, {}, {}>
```

to:

```ts
  <Name extends string, Schema extends $ZodType>(
    name: Name,
    schema: Schema
    // biome-ignore lint/complexity/noBannedTypes: {} is intentional — represents zero indexes/searchIndexes/vectorIndexes
  ): _ZodModel<Name, $ZodShape, Schema, _UnionModelSchemas<Name, Schema>, {}, {}, {}>
```

- [ ] **Step 4: Run type-check and tests**

Run: `bun run type-check && bun run test`
Expected: type-check clean, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/zodvex/src/model.ts packages/zodvex/src/mini/index.ts
git commit -m "feat: add UnionModelSchemas with typed doc/base/docArray

defineZodModel overload 2 now returns UnionModelSchemas<Name, Schema>
instead of ModelSchemas. Preserves the union type in doc, base, insert,
and docArray so consumers get typed access and ConvexTableFor can
compute validators."
```

---

### Task 4: Add union branch to ConvexTableFor

**Files:**
- Modify: `packages/zodvex/src/schema.ts:1-14,83-106`

- [ ] **Step 1: Add imports to schema.ts**

In `packages/zodvex/src/schema.ts`, add `ConvexValidatorFromZod` to the mapping import on line 12, and add `$ZodDiscriminatedUnion` and `$ZodUnion` to the zod-core import on line 14:

Change line 12:
```ts
import { type ConvexValidatorFromZodFieldsAuto, zodToConvex, zodToConvexFields } from './mapping'
```
to:
```ts
import { type ConvexValidatorFromZod, type ConvexValidatorFromZodFieldsAuto, zodToConvex, zodToConvexFields } from './mapping'
```

Change line 14:
```ts
import type { $ZodShape, $ZodType, output as zoutput } from './zod-core'
```
to:
```ts
import type { $ZodDiscriminatedUnion, $ZodShape, $ZodType, $ZodUnion, output as zoutput } from './zod-core'
```

- [ ] **Step 2: Update ConvexTableFor**

Replace lines 83-106 with:

```ts
type ConvexTableFor<E> =
  // zodTable entry — extract .table with full VObject type
  E extends { table: infer T extends TableDefinition }
    ? T
    : // model entry — compute from fields/schema + indexes
      E extends {
          fields: infer F extends Record<string, $ZodType>
          schema: { base: infer Base extends $ZodType }
          indexes: infer I extends Record<string, readonly string[]>
          searchIndexes: infer SI extends Record<string, SearchIndexConfig>
          vectorIndexes: infer VI extends Record<string, VectorIndexConfig>
        }
      ? Base extends $ZodUnion<any> | $ZodDiscriminatedUnion<any, any>
        ? // Union model — compute validator from schema.base (the union type)
          TableDefinition<
            ConvexValidatorFromZod<Base, 'required'>,
            { [K in keyof I]: [...I[K]] },
            { [K in keyof SI]: { searchField: string; filterFields: string } },
            { [K in keyof VI]: { vectorField: string; dimensions: number; filterFields: string } }
          >
        : // Regular model — compute from fields
          TableDefinition<
            VObject<
              ObjectType<ConvexValidatorFromZodFieldsAuto<F>>,
              ConvexValidatorFromZodFieldsAuto<F>
            >,
            { [K in keyof I]: [...I[K]] },
            { [K in keyof SI]: { searchField: string; filterFields: string } },
            { [K in keyof VI]: { vectorField: string; dimensions: number; filterFields: string } }
          >
      : TableDefinition
```

- [ ] **Step 3: Run type-check and tests**

Run: `bun run type-check && bun run test`
Expected: type-check clean, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/zodvex/src/schema.ts
git commit -m "fix: add union model branch to ConvexTableFor

Detects union models via schema.base extending \$ZodUnion or
\$ZodDiscriminatedUnion and computes validators from the union type
instead of from empty fields. Mirrors the runtime logic in
tableFromModel()."
```

---

### Task 5: Fix example app issues

Fix mini import paths, missing `z` import, and pre-existing cleanup/crons errors in both example apps.

**Files:**
- Modify: `examples/task-manager-mini/convex/schema.ts:1`
- Modify: `examples/task-manager-mini/convex/functions.ts:1`
- Modify: `examples/task-manager-mini/convex/activities.ts:1`
- Modify: `examples/task-manager/convex/cleanup.ts` (or the tasks model)
- Modify: `examples/task-manager/convex/crons.ts:7`
- Modify: `examples/task-manager/convex/notifications.ts` (if `.nullable()` needs functional form)

- [ ] **Step 1: Fix mini example imports**

In `examples/task-manager-mini/convex/schema.ts`, change line 1:
```ts
import { defineZodSchema } from 'zodvex/mini/server'
```

In `examples/task-manager-mini/convex/functions.ts`, change line 1:
```ts
import { initZodvex } from 'zodvex/mini/server'
```

In `examples/task-manager-mini/convex/activities.ts`, add missing import at line 1:
```ts
import { z } from 'zod/mini'
```
(Keep the existing `import { zx } from 'zodvex/mini'` on the next line.)

- [ ] **Step 2: Fix full example cleanup.ts**

The cleanup.ts file references index `by_completed` and field `completedAt` that don't exist on the tasks model. Read the tasks model to see available indexes, then update cleanup.ts to use existing indexes, OR add the missing index to the model. Choose whichever approach aligns with the existing model definition.

Check `examples/task-manager/convex/models/task.ts` for available indexes. The task model has `by_created` on `createdAt` but not `by_completed` on `completedAt`. Update the `CLEANUP_INDEX` and `CLEANUP_FIELD` constants in cleanup.ts accordingly.

- [ ] **Step 3: Fix full example crons.ts**

The `crons.daily()` call on line 7 expects 4 args. Check Convex's `cronJobs().daily()` signature — it may require an empty args object as the 4th parameter:

```ts
crons.daily(
  'cleanup completed tasks',
  { hourUTC: 4, minuteUTC: 0 },
  internal.notifications.cleanupOld,
  {}
)
```

Or the issue may cascade from notifications typing — verify after fixes 1-4 are applied.

- [ ] **Step 4: Fix notifications if needed**

If `examples/task-manager/convex/notifications.ts:11` still has `.nullable()` errors after Fix 2 (union model types), change to functional form:

From: `NotificationModel.schema.doc.nullable()`
To: `z.nullable(NotificationModel.schema.doc)`

Check both the full and mini notification files.

- [ ] **Step 5: Type-check both examples**

Run:
```bash
bun run tsc --noEmit -p examples/task-manager/convex/tsconfig.json
bun run tsc --noEmit -p examples/task-manager-mini/convex/tsconfig.json
```
Expected: Zero errors in both.

- [ ] **Step 6: Commit**

```bash
git add examples/
git commit -m "fix(examples): correct import paths and pre-existing type errors

Mini example: use zodvex/mini/server for schema and functions,
add missing z import to activities.ts.
Full example: fix cleanup.ts index references, crons.ts arity."
```

---

### Task 6: Add CI gates

Add `type-check:examples` and `lint:core-types` scripts.

**Files:**
- Modify: `/Users/jshebert/Development/plfx/zodvex/package.json` (root workspace package.json)
- Modify: `packages/zodvex/package.json` (lint:core-types)

- [ ] **Step 1: Add type-check:examples to root package.json**

In the root `package.json`, add to scripts:

```json
"type-check:examples": "tsc --noEmit -p examples/task-manager/convex/tsconfig.json && tsc --noEmit -p examples/task-manager-mini/convex/tsconfig.json"
```

- [ ] **Step 2: Add lint:core-types to packages/zodvex/package.json**

In `packages/zodvex/package.json`, add to scripts:

```json
"lint:core-types": "! grep -rn 'z\\.Zod[A-Z]' src/ --include='*.ts' --exclude-dir=mini --exclude-dir=core --exclude=tables.ts --exclude-dir=form | grep -v '// zod-ok' | grep -v 'import type'"
```

- [ ] **Step 3: Mark legitimate z.Zod* usages with `// zod-ok`**

Add `// zod-ok` comments to lines that legitimately use `z.Zod*` (full-zod-specific types):

In `packages/zodvex/src/model.ts`, `FullZodModelSchemas` type (lines 109-126) — each line with `z.ZodObject`, `z.ZodArray`, etc. needs `// zod-ok` at end of line. Also the overload 1 return type (line 239).

In `packages/zodvex/src/schemaHelpers.ts`, the function overloads and `MapSystemFields` that use `z.ZodObject`, `z.ZodUnion`, `z.ZodDiscriminatedUnion` (lines 41-42, 61-62, 76-77, 115, 131-151).

In `packages/zodvex/src/builders.ts`, the `z.ZodObject<any>` casts (lines 67, 122, 177).

In `packages/zodvex/src/utils.ts`, the function signatures (lines 133, 148, 156).

In `packages/zodvex/src/serverUtils.ts`, `z.ZodError` (lines 11, 34).

In `packages/zodvex/src/db.ts`, the casts (lines 200, 211).

- [ ] **Step 4: Run both gates**

Run:
```bash
bun run type-check:examples
bun run --cwd packages/zodvex lint:core-types
```
Expected: Both pass with zero violations.

- [ ] **Step 5: Commit**

```bash
git add package.json packages/zodvex/package.json packages/zodvex/src/
git commit -m "chore: add CI gates for example type-check and core type lint

type-check:examples: runs tsc --noEmit on both example apps (root pkg).
lint:core-types: greps for z.Zod* in shared code, legitimate uses
marked with // zod-ok (packages/zodvex pkg)."
```

---

### Task 7: Final verification

**Files:** None modified — verification only.

- [ ] **Step 1: Run zodvex type-check**

Run: `bun run type-check`
Expected: Zero errors.

- [ ] **Step 2: Run full test suite**

Run: `bun run test`
Expected: All tests pass (including new diagnostic tests from Tasks 1-2).

- [ ] **Step 3: Type-check both examples**

Run: `bun run type-check:examples`
Expected: Zero errors.

- [ ] **Step 4: Run core type lint**

Run: `bun run --cwd packages/zodvex lint:core-types`
Expected: Zero violations.

- [ ] **Step 5: Build and verify mini outputs**

Run:
```bash
bun run build
grep '"zod"' packages/zodvex/dist/mini/index.js packages/zodvex/dist/mini/server/index.js || echo "PASS: no bare zod imports"
```
Expected: Build succeeds, "PASS: no bare zod imports".
