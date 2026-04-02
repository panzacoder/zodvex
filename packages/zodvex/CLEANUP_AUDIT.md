# `packages/zodvex` Cleanup Audit

Date: 2026-04-01

Scope:
- Review `packages/zodvex/src`
- Check whether the code follows a clear convention
- Look for cruft, leftover files, hacks, and duplicate solutions
- Decide what belongs in the current zod-mini / `zod/v4/core` migration branch vs a follow-up cleanup branch

Method:
- Static review only
- No test runs were performed as part of this audit

Status:
- High-priority packaging cruft cleanup has already been resolved in `4c9e622`
- This document now focuses on the remaining structural cleanup items

## Executive Summary

The package has a fairly clear public API shape at the barrel level:
- `zodvex/core`
- `zodvex/mini`
- `zodvex/server`
- `zodvex/codegen`
- `zodvex/client`
- `zodvex/react`

The main organizational issue is inside `src/`. Domain folders like `mapping/`, `codegen/`, `react/`, and `client/` are coherent, but the root of `src/` is still a mix of:
- current public implementation
- deprecated compatibility layers
- internal helpers
- migration shims
- pure type modules

That makes the package feel historically accumulated rather than convention-driven.

## Resolved Items

### `src/__type-tests__` was accidental shipped cruft

Resolved in `4c9e622`.

Previously:
- `packages/zodvex/tsconfig.json` included `src/**/*.ts`
- `packages/zodvex/package.json` published both `dist` and `src`
- `dist/__type-tests__` was being emitted even though the files said they were not meant for the bundle

This was the best candidate for the current zod-mini branch because it was low-risk and directly adjacent to the type migration.

### `scratch/` contained tracked exploratory files

Resolved in `4c9e622`.

Removed exploratory files under `packages/zodvex/scratch/`.

## Convention Clarity

The code does follow some real conventions:
- `zod-core.ts` acts as the compatibility hub for `zod/v4/core`
- the public entrypoint barrels are explicit and documented
- `mapping/` is well-structured, with `core.ts`, `handlers/`, `types.ts`, and `utils.ts`

### Remaining inconsistencies

#### 1. No clear rule for flat file vs directory

The package has both:
- subdirectory-based domains: `cli/`, `codegen/`, `mapping/`, `react/`, `client/`, `server/`, `core/`, `mini/`
- many root-level modules: `model.ts`, `tables.ts`, `db.ts`, `custom.ts`, `init.ts`, `rules.ts`, `types.ts`, `utils.ts`, `wrappers.ts`, etc.

Natural groupings already exist but are not reflected in the layout:
- codec layer: `codec.ts`, `normalizeCodecPaths.ts`, `boundaryHelpers.ts`
- function-builder layer: `wrappers.ts`, `custom.ts`, `builders.ts`, `customization.ts`
- DB/rules layer: `db.ts`, `rules.ts`, `ruleTypes.ts`

Assessment:
- This is a readability and maintenance problem
- It is important, but it is not important to the zod-mini migration itself

#### 2. `zod-core.ts` is a convention, but not a fully enforced one

`zod-core.ts` exists as the compatibility import hub, but some files still bypass it with direct type-only imports from `zod/v4/core`, notably:
- `src/types.ts`
- `src/mapping/types.ts`

Because these are type-only imports, there is no runtime problem. The issue is mainly consistency:
- either `zod-core.ts` is the canonical import point
- or it is only a runtime/value-level convenience layer

Assessment:
- Not urgent
- Worth clarifying in a follow-up cleanup so the convention is explicit

## Deprecated Surface Still Being Maintained

Significant deprecated API surface is still live in the package:

| File | Deprecated surface | Preferred replacement |
|------|--------------------|------------------------|
| `tables.ts` | `zodTable()`, `zodDoc()`, `zodDocOrNull()` | `defineZodModel()` |
| `builders.ts` | all six builder helpers | `initZodvex()` |
| `ids.ts` | `zid()` | `zx.id()` |
| `codec.ts` | `convexCodec()`, `ConvexCodec<T>` | `initZodvex()` or `decodeDoc` / `encodeDoc` |
| `types.ts` | `ExtractCtx`, `PreserveReturnType` | direct Convex types |
| `utils.ts` | `mapDateFieldToNumber()` | `zx.date()` |

### Deprecated APIs are still prominent in the main server surface

`src/server/index.ts` exports both the newer `initZodvex` path and older deprecated builders and helpers side-by-side.

That may be necessary for backwards compatibility, but it makes the architecture less obvious:
- what is the preferred path
- what is legacy
- what is internal plumbing

Assessment:
- This is more of an API-surface clarity problem than dead code
- It should be handled in a dedicated cleanup branch, not mixed into the current refactor

### `wrappers.ts` is only live through deprecated builders

`wrappers.ts` is not exported from any public entrypoint. It is still live internal code today because `builders.ts` imports it, but if the deprecated builder layer is removed then `wrappers.ts` becomes dead immediately.

Assessment:
- This is not dead code yet
- It is effectively legacy infrastructure coupled to deprecated builders

## Duplicates and Near-Duplicates

### 1. `ensureOptional()` is an exact duplicate

The same helper exists in:
- `model.ts`
- `tables.ts`

Both functions wrap a schema in `$ZodOptional` if it is not already optional.

Assessment:
- Small but real duplication
- Good candidate for extraction into `schemaHelpers.ts` or another shared schema helper module

### 2. `model.ts` and `tables.ts` duplicate the same schema-construction logic

This is the strongest duplication in the package.

Both files independently build:
- `doc`
- `docArray`
- `paginatedDoc`
- `update`
- `base` / `insert`

Both also maintain similar helper logic:
- `ensureOptional`
- object path handling
- union path handling
- system field addition

The duplication is especially obvious between:
- the raw-shape path in `defineZodModel()`
- the object path in `zodTable()`
- `createUnionModel()` in `model.ts`
- the union branch of `zodTable()`

Risk:
- Bug fixes may land in one path and not the other
- zod-mini compatibility changes can drift between the two implementations
- the deprecated path remains coupled to the preferred path, but only informally

Assessment:
- This is the most important structural cleanup item
- It is too broad to fold into the zod-mini migration branch unless a bug forces it

### 3. The wrapper stack has multiple parallel implementations

There are several overlapping layers for function wrapping:
- `wrappers.ts`
- `builders.ts`
- `custom.ts`
- `init.ts`

Some of that is intentional because the APIs are different, but there is still a lot of repeated flow:
- normalize args input
- parse Zod input
- convert to Convex validators
- validate returns
- strip `undefined`
- attach metadata

Assessment:
- Worth cleaning up
- Not a good fit for the current zod-mini branch

### 4. `getObjectShape()` is duplicated intentionally

There are two versions:
- `mapping/utils.ts` contains the normal helper
- `utils.ts` contains a private copy

This duplication appears intentional. The comment in `utils.ts` says the private copy exists because importing from `./mapping` would pull `convex/values` into client bundles.

Assessment:
- This is a deliberate split, not accidental copy-paste residue
- Still worth documenting more clearly, because any bug fix to shape extraction now has two homes

### 5. `zx.id()` and `zid()` are near-identical implementations

`zx.id()` and `zid()` both:
- create a refined string schema
- attach Convex ID metadata via `registryHelpers`
- add the `_tableName` marker used for type-level detection

`zid()` is deprecated, but the implementation is still largely duplicated.

Assessment:
- Reasonable cleanup candidate
- One should probably delegate to the other if both remain

## Naming / Architecture Smells

### 1. `rules.ts` and `ruleTypes.ts` are functionally split but not very discoverable

The split exists to break a circular dependency between `db.ts` and `rules.ts`:
- `ruleTypes.ts` contains shared types
- `rules.ts` contains implementations and re-exports the public rule types

That is defensible, but the naming is not very communicative.

Assessment:
- Not urgent
- Worth either renaming or documenting more explicitly

### 2. Deprecated and preferred implementation paths are layered together at the root

The root of `src/` currently contains the preferred system and the compatibility system together:
- `init.ts` and `model.ts` as the preferred direction
- `builders.ts`, `wrappers.ts`, `tables.ts`, `ids.ts`, and parts of `codec.ts` as compatibility layers

Assessment:
- This is the main reason the tree feels less organized than the public API suggests

## Compatibility Hacks Still in Active Code

Examples:
- `serverUtils.ts` checks for `"unidirectional transform"` by matching an error message string
- `mapping/core.ts` still maps native `z.date()` to `v.float64()` for legacy inference compatibility, even though runtime support is intentionally rejected elsewhere

These may be justified, but they are still hacks:
- they depend on behavior that is not strongly modeled in types
- they encode migration knowledge into the runtime layer

Assessment:
- Track as cleanup debt
- Do not expand this work inside the current branch unless one of these paths is directly blocking zod-mini correctness

## Recommended Split: Fix Now vs Later

### Already fixed in the current zod-mini / `zod/v4/core` branch

- Stop shipping `src/__type-tests__`
- Remove tracked exploratory `scratch/` artifacts

These were the right things to include because they:
- improved the package boundary
- reduced shipped noise
- were low-risk and easy to review

### Keep for the follow-up cleanup branch

#### 1. Reorganize the package structure under `src/`

Examples:
- group server-only internals more aggressively
- separate preferred implementation from legacy compatibility modules
- reduce the number of unrelated root-level files

#### 2. Clarify the `zod-core.ts` convention

Examples:
- decide whether it is the canonical import point
- or document that type-only imports may bypass it

#### 3. Clarify or demote deprecated entrypoints

Examples:
- better isolation for deprecated builders
- clearer naming or placement for compatibility layers
- less prominence in `server/index.ts`

#### 4. Deduplicate `model.ts` and `tables.ts`

This is probably the most important structural cleanup, but also the riskiest to mix with unrelated refactors.

#### 5. Deduplicate wrapper logic across `wrappers.ts`, `builders.ts`, `custom.ts`, and `init.ts`

This would reduce maintenance cost, but likely creates large diffs across multiple public-adjacent layers.

#### 6. Collapse obvious compatibility duplicates if the old APIs remain

Examples:
- extract `ensureOptional()`
- have `zx.id()` and `zid()` share a single implementation
- better document or isolate the duplicated `getObjectShape()` helper

#### 7. Review hacks and compatibility shims

Examples:
- message-string detection in return validation fallback
- legacy `z.date()` handling
- other migration-era guardrails and special cases

#### 8. Revisit how much deprecated surface should exist at all

Because the package is still pre-1.0, there is a broader product question:
- continue carrying deprecated compatibility layers
- or remove more of them outright and simplify the codebase aggressively

If the answer is "remove", that would likely eliminate a large share of the current duplication:
- `tables.ts`
- `builders.ts`
- `wrappers.ts`
- `zid()`
- deprecated codec helpers
- deprecated type helpers
- `mapDateFieldToNumber()`

## Practical Recommendation

Use this rule for the current branch:

Include only changes that:
- improve zod-mini correctness
- reduce noise in shipped artifacts
- are low-risk and easy to review in isolation

Defer changes that:
- rearrange architecture
- merge duplicated implementations
- change the prominence of deprecated APIs
- touch multiple public surfaces at once

## Suggested Follow-up Branch Scope

If a dedicated cleanup branch is created, a good scope would be:

1. Reorganize `src/` around clearer domain boundaries
2. Isolate or reduce deprecated API surface
3. Consolidate schema-derivation logic between `model.ts` and `tables.ts`
4. Consolidate function wrapper plumbing where practical
5. Normalize small compatibility duplicates
6. Revisit hacks and naming debt

That branch should be reviewed as structural cleanup, not as part of the zod-mini migration.
