# zodvex Architecture

This document describes the current architectural shape of zodvex after the
full/mini refactor completed on April 7, 2026.

## Overview

zodvex now has a deliberately layered design:

1. A shared Zod v4 core substrate built on `zod/v4/core`
2. Flavor-owned public helper surfaces for full Zod and zod/mini
3. A shared model pipeline for schema bundle assembly and Convex lowering
4. A shared function-contract pipeline for wrappers, builders, and `initZodvex`
5. Thin deprecated compatibility layers kept only to avoid breaking users

The goal is to make flavor differences explicit at the public boundary while
keeping behavior, schema lowering, and codec semantics centralized.

## Layering

### Shared Core Substrate

`src/internal/zod-core.ts` is the internal compatibility boundary for Zod v4.
All shared modules constrain against `$ZodType`, `$ZodObject`, `$ZodUnion`, and
the other core classes exported from `zod/v4/core`.

That gives zodvex one stable internal type system for:

- full `zod`
- `zod/mini`
- internal `instanceof` checks
- codec encode/decode handling
- schema introspection used by mapping and codegen

The shared substrate should be thought of as **Zod v4 core**, not as either the
full or mini flavor.

### Public Flavor Surfaces

Public flavor differences now live at explicit entrypoints:

- `zodvex`: full-Zod helper surface
- `zodvex/mini`: mini helper surface
- `zodvex/server`: shared server runtime, compatible with both
- `zodvex/core`: deprecated compatibility alias to `zodvex`

Internally, the public helper modules now live under the explicit public tree:

- `src/public/index.ts`
- `src/public/model.ts`
- `src/public/zx.ts`
- `src/public/mini/index.ts`
- `src/public/mini/model.ts`
- `src/public/mini/zx.ts`

This is intentionally different from the old design, where mini behavior was a
mix of shared runtime exports, handwritten facade casts, and build aliasing.

### Why `full` and `mini`, not `v4` and `mini`

Both flavors are Zod v4. Using `v4` as the name of the "main" flavor blurs the
difference between version and flavor.

The clearer mental model is:

- Zod v4 core: shared internal substrate
- full: classic full-Zod public surface
- mini: zod/mini public surface

In the source tree that now maps to:

- `src/public/*`: canonical public surfaces
- `src/internal/*`: shared implementation
- `src/legacy/*`: deprecated runtime APIs
- `src/core/*`: compatibility alias only

## Model Pipeline

### Preferred API

`defineZodModel()` is the primary model-definition API.

Models may be built from:

- raw object shapes
- `z.object(...)`
- unions or discriminated unions

Each model owns:

- user fields
- schema bundle (`insert`, `doc`, `update`, `docArray`, `paginatedDoc`)
- index/search/vector metadata
- enough metadata for `defineZodSchema()` and `ctx.db` wrappers to reason about
  decoded versus wire behavior

### Canonical Schema Bundle

Schema bundle assembly is centralized in `src/internal/modelSchemaBundle.ts`.

That module is the shared source of truth for:

- document schema
- insert schema
- update schema
- array schema
- paginated schema

This is used by both:

- `src/internal/model.ts`
- `src/legacy/tables.ts`

That matters because the old design let `defineZodModel` and `zodTable` each
reconstruct similar schemas in slightly different ways.

### Model Metadata and Schema Lowering

`defineZodSchema()` should not reverse-engineer model structure from incidental
details like "does this model have fields". It now consumes explicit model
metadata and lowers models into Convex tables from that shared representation.

The important modules are:

- `src/internal/model.ts`
- `src/internal/meta.ts`
- `src/internal/schema.ts`

The key architectural rule is:

**Model creation owns schema semantics. Schema lowering consumes model metadata.
It does not rediscover model shape independently.**

## Function Contract Pipeline

### Shared Contract Compilation

All function registration flows now share the same contract machinery in
`src/internal/functionContracts.ts`.

That layer owns:

- args schema normalization
- return schema normalization
- Convex validator generation
- parse/decode of incoming args
- encode/finalize of outgoing returns
- metadata attachment
- customization input merging

### Thin Public Builders

The public entrypoints are now mostly shells over that shared contract layer:

- `src/internal/wrappers.ts`
- `src/internal/builders.ts`
- `src/internal/custom.ts`
- `src/internal/init.ts`

That means `zQuery`, `zMutation`, `zAction`, the legacy builder helpers, custom
builders, and `initZodvex()` all share the same behavioral core instead of
copying validation and metadata logic in parallel.

### `initZodvex` as the Main Runtime Entry

`initZodvex()` is the preferred runtime setup API.

It composes:

- a schema created by `defineZodSchema()`
- Convex server builders from `convex/_generated/server`
- optional codec DB wrapping
- optional registry-aware action helpers

The returned builders (`zq`, `zm`, `za`, `ziq`, `zim`, `zia`) are the intended
mainline path for server projects.

## Codecs, Wire Types, and Runtime Types

zodvex stays codec-first.

Every important boundary must preserve the distinction between:

- wire type: what Convex stores or validates
- runtime type: what handlers work with

This affects:

- function args
- function returns
- database reads
- database writes
- index/filter comparisons

`zx.date()` remains the canonical example:

- wire: `number`
- runtime: `Date`

The architectural rule is:

**shared runtime layers own encode/decode behavior once; examples and wrappers
should not paper over that behavior manually.**

This is why the refactor also moved index/filter handling back toward shared DB
machinery instead of letting examples carry ad hoc `getTime()` workarounds.

## Codegen

zodvex codegen is now clearly separate from the main runtime architecture.

The generated `_zodvex/*` files are optional helper output for:

- function registry metadata
- typed client helpers
- typed react helpers
- typed server helper aliases

They are not required for `defineZodModel`, `defineZodSchema`, or `initZodvex`
to work.

Quickstart should remain the canonical example of:

- no `zodvex generate`
- no checked-in `_zodvex` output
- still using Convex's own `_generated` files

## Deprecated Compatibility Surfaces

### `tables.ts`

`src/legacy/tables.ts` is now treated as a compatibility layer.

It is intentionally:

- full-Zod only
- deprecated
- not part of the mini design
- not a source of truth for newer architecture work

Refactors should continue pushing shared runtime logic downward so `tables.ts`
becomes cheaper to keep until removal, but it should not receive new capability
work.

Migration target:

- `zodTable(...)`
- `zodDoc(...)`
- `zodDocOrNull(...)`

becomes:

- `defineZodModel(...)`
- `defineZodSchema(...)`
- `initZodvex(...)`

See [v0.6 migration](./migration/v0.6.md).

## Source Layout

The current source tree is organized around intent:

- `src/public/*`
  - canonical public full and mini helper surfaces
  - entrypoint implementations for `zodvex`, `zodvex/mini`, and related client/server helpers
- `src/internal/*`
  - shared runtime and type machinery
  - model/schema/function pipelines
  - mapping, codec, DB, and rule internals
- `src/legacy/*`
  - deprecated runtime APIs kept for migration
- `src/core/*`
  - compatibility-only alias surface for `zodvex/core`
- top-level `src/index.ts`, `src/server/index.ts`, `src/client/index.ts`, `src/react/index.ts`, `src/mini/*`
  - thin wrappers that preserve stable package paths while delegating into `public/*`

### Legacy Builder Helpers

The following remain supported but are no longer the design center:

- `zQueryBuilder`
- `zMutationBuilder`
- `zActionBuilder`
- `zCustomQueryBuilder`
- `zCustomMutationBuilder`
- `zCustomActionBuilder`

They now delegate through the shared contract layer and should be treated as
compatibility APIs.

## Verification Strategy

The repo now distinguishes between two kinds of example verification:

### Offline Verification

Cheap checks that should stay runnable in CI or before a release:

- package typecheck/tests/build
- task-manager typecheck/test/generate
- task-manager-mini typecheck/test/generate
- stress-test typecheck/generate/measure/report using temp result directories
- mini import guard

The repo root script for this path is `bun run verify:examples`.

### Deployment-Backed Verification

Checks that require a configured Convex deployment:

- `bunx convex dev --once`
- example smoke tests
- quickstart Convex bootstrap and typecheck

These are important before a beta release, but they should stay separate from
the cheap default verification path.

The repo root script for this path is `bun run verify:examples:network`.

## Current Preferred Mental Model

If you are changing zodvex today, use this model:

1. Flavor concerns belong at the public entrypoint boundary.
2. Shared runtime behavior belongs below that boundary on Zod v4 core types.
3. Model assembly has one canonical schema bundle path.
4. Function registration has one canonical contract path.
5. Deprecated APIs should get thinner, not smarter.
