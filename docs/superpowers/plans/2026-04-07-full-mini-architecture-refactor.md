# Full/Mini Architecture Refactor Plan

## Goal

Replace the current split-brain `zodvex/core` + `zodvex/mini` design with a clearer architecture that:

- uses one explicit flavor boundary instead of separate build-time and type-level tricks
- keeps shared behavior in a single core implementation over `zod/v4/core`
- removes duplicated model-building and function-registration pipelines
- makes the real integration surface (`examples/task-manager*`) part of the normal verification loop

## Problem Summary

The current design has drifted into a whackamole state:

- runtime flavoring is handled by the mini build alias in `packages/zodvex/tsup.config.ts`
- public mini typing is hand-maintained in `packages/zodvex/src/mini/index.ts`
- model construction logic is duplicated between the raw-shape and union paths
- function registration logic is duplicated across wrappers, builders, custom builders, and `initZodvex`
- package tests can pass while the actual `task-manager-mini` consumer still fails typecheck

This creates too many places where one conceptual change must be kept in sync by hand.

## Target Architecture

### 1. Shared Core Over `zod/v4/core`

Keep one shared behavioral core that works only in terms of:

- `$ZodType` and subclasses
- `parse` / `safeParse`
- `encode`
- `_zod.def` shape inspection where necessary

This layer should contain behavior, not flavor decisions.

### 2. Explicit Flavor Boundary

Introduce a small internal flavor boundary with parallel ownership:

- `full`
- `mini`

This boundary owns:

- schema construction helpers (`object`, `array`, `optional`, `nullable`, `union`, `codec`, `custom`)
- flavor-specific helper typing for `zx`
- flavor-specific schema bundle typing for models

Shared modules should stop importing `z` from `'zod'` directly when constructing schemas.

### 3. Canonical Model Descriptor Pipeline

Introduce one internal representation for models, for example:

- schema bundle
- index/search/vector metadata
- lowered Convex table metadata

The model pipeline should become:

1. build schema bundle
2. apply immutable index metadata
3. lower descriptor to Convex table/schema

`defineZodModel` should stop duplicating raw-shape and union assembly logic.
`defineZodSchema` should stop reverse-engineering model state.

### 4. Canonical Function Contract Pipeline

Introduce one internal function-contract compiler that owns:

- args normalization
- raw shape vs object schema handling
- Convex validator generation
- args parsing / decode
- return validation / encode
- metadata attachment
- native `z.date()` rejection

Then make these surfaces delegate to it:

- `zQuery` / `zMutation` / `zAction`
- legacy builders
- custom builders
- `initZodvex`

### 5. Compatibility Layer for Legacy APIs

Keep older APIs working, but move them behind a compatibility layer that wraps the new shared pipelines instead of being their own design centers.

## Execution Plan

### Phase 0: Stop Further Drift

- add example typechecks to CI
- add a guard against importing `zodvex/core` inside `examples/task-manager-mini`
- treat the example apps as integration packages, not just demos
- update architecture docs as the refactor lands so future work follows the new boundaries

### Phase 1: Extract the Flavor Boundary

- create internal `full` and `mini` flavor modules
- move schema construction behind that boundary
- keep the public entrypoints stable while the internals are rearranged

### Phase 2: Replace the Manual Mini Facade

- remove the hand-maintained `mini/index.ts` type facade
- replace it with flavor-owned public modules built on the shared core
- delete the `as any` entrypoint overrides for `defineZodModel` and `zx`

### Phase 3: Extract the Model Descriptor

- unify the raw-shape and union model paths
- centralize schema bundle construction
- lower model descriptors into Convex tables from one place

### Phase 4: Extract the Function Contract Compiler

- centralize args/returns compilation
- make wrappers, builders, custom builders, and `initZodvex` delegate to that shared compiler

### Phase 5: Cleanup and Documentation

- push legacy APIs behind compatibility wrappers
- simplify architecture docs to reflect the new layering
- remove obsolete comments and stale design assumptions

## Verification Gates

Each phase must keep the following green:

- `bun run --cwd packages/zodvex type-check`
- `bun run --cwd packages/zodvex test`
- `bun run type-check:examples`

Additional checks:

- `task-manager-mini` must not import `zodvex/core`
- mini-targeted tests must keep passing
- no accidental public API break unless explicitly planned

## PR Breakdown

1. CI + mini example import hygiene
2. internal flavor boundary extraction
3. replace manual mini facade
4. model descriptor refactor
5. function contract refactor
6. compatibility cleanup + docs

## First Execution Slice

Start with the smallest change that improves correctness immediately:

1. wire example typechecks into CI
2. remove mixed `core` imports from `examples/task-manager-mini`
3. verify the examples again

This creates a better safety net before deeper internal refactors begin.
