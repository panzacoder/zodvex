# Source Reorg Execution Plan

Date: 2026-04-08

This plan converts the source organization audit into concrete actions.

## Goal

Reorganize `packages/zodvex/src` into a structure that clearly separates:

- public entrypoints
- shared internal implementation
- legacy / compatibility surfaces

without changing the intended public API more than necessary.

## Target Public Contract

### Canonical Full Flavor

- `zodvex`
- `zodvex/server`
- `zodvex/react`
- `zodvex/client` only if it remains meaningfully narrower than `zodvex`

### Canonical Mini Flavor

- `zodvex/mini`
- `zodvex/mini/server`
- `zodvex/mini/react` only if there is an actual mini React surface later
- `zodvex/mini/client` only if there is an actual mini client surface later

### Compatibility

- `zodvex/core` remains as a deprecated alias
- deprecated root symbols from older releases should get friendly stubs or move to `zodvex/legacy`

## Target Source Shape

```text
src/
  public/
    index.ts
    server.ts
    react.ts
    client.ts
    mini/
      index.ts
      server.ts
  internal/
    codec/
    functions/
    model/
    schema/
    mapping/
    db/
    rules/
    shared/
  legacy/
    index.ts
    tables.ts
  compat/
    core.ts
```

Notes:

- Exact filenames can vary, but the public/internal/legacy/compat split should be explicit.
- `full/` should disappear. Its job is either root `public/index.ts` or temporary compat, not a permanent third name.
- `core/` should disappear as a source namespace and become a thin compat barrel.

## Keep / Move / Merge / Delete

### Keep As Public Entrypoints

- `src/index.ts`
- `src/server/index.ts`
- `src/mini/index.ts`
- `src/mini/server/index.ts`
- `src/client/index.ts`
- `src/client/zodvexClient.ts`
- `src/react/index.ts`
- `src/react/hooks.ts`
- `src/react/zodvexReactClient.ts`
- `src/codegen/index.ts`
- `src/codegen/*`
- `src/cli/index.ts`
- `src/cli/*`
- `src/labs/index.ts`
- `src/form/mantine/index.ts`

Action:

- Move them under `public/`
- update package exports to point to new public files

### Move To Internal

#### Internal Codec / Shared Validation

- `src/boundaryHelpers.ts`
- `src/codec.ts`
- `src/ids.ts`
- `src/normalizeCodecPaths.ts`
- `src/registry.ts`
- `src/results.ts`
- `src/stripUndefined.ts`
- `src/types.ts`
- `src/utils.ts`
- `src/zod-core.ts`
- `src/zx.ts`

Suggested destination:

- `internal/codec/`
- `internal/shared/`

#### Internal Model / Schema

- `src/meta.ts`
- `src/model.ts`
- `src/modelSchemaBundle.ts`
- `src/schema.ts`
- `src/schemaHelpers.ts`

Suggested destination:

- `internal/model/`
- `internal/schema/`

#### Internal Functions

- `src/actionCtx.ts`
- `src/builders.ts`
- `src/custom.ts`
- `src/customization.ts`
- `src/functionContracts.ts`
- `src/init.ts`
- `src/serverUtils.ts`
- `src/wrappers.ts`

Suggested destination:

- `internal/functions/`

#### Internal Mapping

- `src/mapping/*`

Suggested destination:

- `internal/mapping/`

#### Internal DB / Rules

- `src/db.ts`
- `src/rules.ts`
- `src/ruleTypes.ts`

Suggested destination:

- `internal/db/`
- `internal/rules/`

### Move To Legacy

- `src/tables.ts`

Potentially also later:

- deprecated builder exports currently surfaced from `builders.ts`
- deprecated helper exports that still exist only for migration

Action:

- create `zodvex/legacy`
- move runtime implementation to `legacy/`
- keep root stubs for removed legacy root exports where needed

### Move To Compat

- `src/core/index.ts`
- `src/core/codec.ts`
- `src/core/model.ts`
- `src/core/zx.ts`

Action:

- replace with thin compat barrels or generated wrappers under `compat/`
- keep deprecation markers heavy and obvious

### Merge / Collapse

#### `full/` namespace

Files:

- `src/full/index.ts`
- `src/full/codec.ts`
- `src/full/model.ts`
- `src/full/zx.ts`

Action:

- fold into the canonical root public surface
- root `zodvex` should own the full flavor directly
- `full/` should not remain a parallel source concept

#### `core/` namespace

Action:

- collapse into compatibility-only re-exports of root public files
- do not keep separate implementation or architecture under `core/`

#### `utils.ts`

Current mixed responsibilities:

- generic object picking
- return-schema helpers
- pagination helper
- date mapping
- schema-picking utilities
- native `z.date()` assertion
- re-export of `stripUndefined`

Action:

- split after the directory reorg
- suggested destinations:
  - `internal/shared/object.ts`
  - `internal/schema/dateGuards.ts`
  - `internal/codec/pagination.ts`

### Delete If Confirmed Redundant

Nothing should be deleted blindly before the move, but these are likely collapse candidates:

- `src/full/zx.ts`
- `src/core/codec.ts`
- `src/core/model.ts`
- `src/core/zx.ts`

They are thin enough that they likely vanish once the public/compat split is explicit.

## Phase Order

### Phase 0: Freeze The Contract

Do first.

Decide and document:

- root `zodvex` stays the canonical full-flavor surface
- `zodvex/server` stays the only server-only full-flavor surface
- `zodvex/core` becomes compatibility-only
- `zodvex/legacy` exists for deprecated runtime exports
- whether `zodvex/client` is a real distinct surface or should be folded into root

### Phase 1: Introduce New Top-Level Namespaces

Add:

- `src/public/`
- `src/internal/`
- `src/legacy/`
- `src/compat/`

Do not move everything at once. Start by moving the thin wrappers and barrels.

### Phase 2: Collapse `full/` Into Root Public

Move:

- `src/full/index.ts` -> `src/public/index.ts`
- `src/full/codec.ts` -> `src/public/codec.ts` or inline into root barrel strategy
- `src/full/model.ts` -> `src/public/model.ts`
- `src/full/zx.ts` -> remove or merge into root public files

### Phase 3: Collapse `core/` Into Compat

Move:

- `src/core/*` -> `src/compat/*`

Behavior:

- every compat file should only re-export canonical public files
- no real implementation should remain there

### Phase 4: Move Shared Implementation Under Internal

Move grouped domains:

- functions
- model/schema
- codec/shared
- mapping
- db/rules

This is mostly mechanical once root/full/core confusion is resolved.

### Phase 5: Move `tables.ts` To Legacy

Add:

- `zodvex/legacy`

Then:

- move `tables.ts`
- add root stubs for deprecated removed root exports as needed

### Phase 6: Clean Up Overlap

After moves:

- split `utils.ts`
- remove dead wrappers
- reduce thin alias files
- add import-boundary rules

## Blocking Decisions

### 1. Is `zodvex/client` real?

If it is just "client-safe subset", it is redundant with root.

Keep only if it has a distinct purpose such as:

- runtime client adapters only
- smaller browser-specific surface
- no schema/model helpers

Otherwise remove it from the final namespace design.

### 2. Do we want `zodvex/legacy` immediately?

I think yes, because it gives a clean home for:

- `zodTable`
- `zodDoc`
- `zodDocOrNull`
- potentially old builders later

and lets root remain client-safe.

### 3. Do we keep `src/full/model.ts` / `src/mini/model.ts` duplication?

Short term: yes.

It is currently serving a real purpose:

- public declarations must not reference internal `dist/*`

If we later find a cleaner way to share the public type layer without leaking internals, that can be a follow-up.

## Recommended Immediate Execution Order

1. Commit this plan.
2. Decide whether `zodvex/client` stays.
3. Add `zodvex/legacy` and root deprecation stubs.
4. Collapse `full/` into the root public surface.
5. Convert `core/` into explicit compat-only barrels.
6. Move grouped internals under `internal/`.
7. Split `utils.ts` and remove remaining thin wrappers.

## Success Criteria

- A new contributor can identify public vs internal vs legacy by path alone.
- No top-level internal module appears to be the main public API.
- `zodvex`, `zodvex/server`, `zodvex/mini`, and `zodvex/mini/server` are obvious from the tree.
- `zodvex/core` is visibly compatibility-only.
- `zodvex/legacy` is the only home for deprecated runtime exports.
- Public declaration files do not reference internal implementation modules.

