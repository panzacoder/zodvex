# Source Organization Audit

Date: 2026-04-07

## Summary

`packages/zodvex/src` is not mainly suffering from "too many files". It is suffering from mixed taxonomy.

The current tree mixes four different concerns in the same namespace:

1. Public entrypoints
2. Flavor-specific public wrappers
3. Shared internal implementation
4. Legacy / compatibility surfaces

That is why `src/model.ts`, `src/zx.ts`, and `src/codec.ts` look like canonical public modules even though the real public full-Zod surface currently lives in `src/full/*`, is re-exported from `src/index.ts`, and is also mirrored by `src/core/*`.

## Classification

### Public Entrypoints

These are real public surfaces and should ultimately live under a `public/` namespace:

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

Notes:

- `src/index.ts` is currently the root full-Zod barrel.
- `src/server/index.ts` is the real server-only entrypoint.
- `src/mini/index.ts` and `src/mini/server/index.ts` are real mini entrypoints, not just aliases.

### Compatibility / Alias Layer

These are thin compatibility wrappers, not real implementation modules:

- `src/core/index.ts`
- `src/core/codec.ts`
- `src/core/model.ts`
- `src/core/zx.ts`

Notes:

- `src/core/*` is currently a deprecated compatibility alias over `src/full/*`.
- These files should not survive long-term once the public import contract is settled.

### Flavor-Specific Public Wrappers

These are real public wrapper modules, but they mostly project shared internals into entrypoint-specific types:

- `src/full/index.ts`
- `src/full/codec.ts`
- `src/full/model.ts`
- `src/full/zx.ts`
- `src/mini/codec.ts`
- `src/mini/model.ts`
- `src/mini/zx.ts`

Notes:

- `src/full/zx.ts` is just a pass-through re-export of `src/zx.ts`.
- `src/full/codec.ts` and `src/mini/codec.ts` are thin public type wrappers over shared `src/codec.ts`.
- `src/full/model.ts` and `src/mini/model.ts` now carry duplicated public type-layer logic because the emitted `.d.ts` surface cannot leak internal `dist/model`.

### Shared Internal Implementation

These are not public entrypoints and should ultimately live under `internal/`:

#### Function / Wrapper Pipeline

- `src/actionCtx.ts`
- `src/builders.ts`
- `src/custom.ts`
- `src/customization.ts`
- `src/functionContracts.ts`
- `src/init.ts`
- `src/serverUtils.ts`
- `src/wrappers.ts`

Notes:

- This is a coherent domain and should likely become something like `internal/functions/`.
- `builders.ts` is deprecated API surface, but the file itself is part of the function pipeline cluster.

#### Model / Schema Pipeline

- `src/meta.ts`
- `src/model.ts`
- `src/modelSchemaBundle.ts`
- `src/schema.ts`
- `src/schemaHelpers.ts`

Notes:

- This is another coherent domain and should likely become `internal/model/` or `internal/schema/`.
- `src/model.ts` is shared runtime plus shared generic type substrate.

#### Codec / Validation / Shared Utilities

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

Notes:

- These are mostly client-safe shared internals.
- `src/utils.ts` is too broad and should eventually be split by domain.
- `src/zx.ts`, `src/codec.ts`, and `src/model.ts` are especially misleading because they look like public canonical modules.

#### Mapping Domain

- `src/mapping/index.ts`
- `src/mapping/core.ts`
- `src/mapping/types.ts`
- `src/mapping/utils.ts`
- `src/mapping/handlers/*`

Notes:

- This is actually one of the cleaner domains already.
- It should stay grouped, just moved under `internal/` if the public/internal split happens.

#### Database / Rules Domain

- `src/db.ts`
- `src/rules.ts`
- `src/ruleTypes.ts`

Notes:

- These are large and important enough to deserve their own domain folder eventually.

### Legacy / Deprecated Surface

- `src/tables.ts`

Notes:

- `tables.ts` is the clearest legacy module in the tree.
- It should move to `legacy/` as soon as the namespace cleanup begins.

## Overlap and Confusion Hotspots

### 1. `root` vs `core` vs `full`

This is the worst current overlap.

Today all three exist:

- `src/index.ts`
- `src/core/*`
- `src/full/*`

But they are all describing the same full-Zod client-safe concept from different angles:

- `index.ts` is the root public barrel
- `core/*` is the compatibility alias barrel
- `full/*` is the real implementation-facing public wrapper layer

This is too many names for one idea.

### 2. Shared internals have public-looking names

These files look canonical but are really shared internal implementation:

- `src/model.ts`
- `src/codec.ts`
- `src/zx.ts`

That is why the repo feels backward when reading it for the first time.

### 3. Public type-layer duplication now exists in `full/model.ts` and `mini/model.ts`

This duplication is real.

It was introduced to keep the emitted public declaration surface self-contained and avoid leaking `dist/model` into consumer declaration emit.

That duplication is currently acceptable as a packaging fix, but it should be treated as public type-wrapper duplication, not shared runtime duplication.

### 4. `utils.ts` is carrying multiple unrelated responsibilities

Current contents include:

- `returnsAs`
- `zPaginated`
- `mapDateFieldToNumber`
- schema-picking helpers
- native `z.date()` detection
- re-export of `stripUndefined`

This should eventually be split by domain.

## Deprecated / Compatibility Files Worth Isolating

These are intentionally not part of the long-term primary design:

- `src/core/*`
- `src/tables.ts`
- deprecated builder APIs inside `src/builders.ts`
- deprecated helpers in `src/codec.ts`
- deprecated `zid` in `src/ids.ts`

These should be easy to spot in the tree. Right now they are not.

## Noisy But Legitimate Files

These are large, but they do not look conceptually misplaced:

- `src/codegen/generate.ts`
- `src/codegen/discover.ts`
- `src/mapping/core.ts`
- `src/mapping/types.ts`
- `src/db.ts`
- `src/rules.ts`

These need organization, but not necessarily semantic redesign.

## Recommended Next Reorg Shape

```text
src/
  public/
    root/
    core/
    server/
    mini/
    mini-server/
    client/
    react/
    codegen/
    cli/
    labs/
    form/
  internal/
    functions/
    model/
    schema/
    codec/
    mapping/
    db/
    rules/
    shared/
  legacy/
    tables.ts
```

That does not need to be the exact final folder spelling, but the public/internal/legacy split is the important part.

## Recommended Order

### Phase 1: Cleanup Before Moving Files

Do this first.

- Decide the public contract between `zodvex`, `zodvex/core`, and `zodvex/server`
- Keep `src/core/*` or remove it, but stop having `root`, `core`, and `full` all represent the same idea
- Mark `tables.ts` as legacy in the tree, not just in docs
- Decide whether `full/*` is temporary or long-term

### Phase 2: Mechanical Reorg

- Move public entrypoints under `public/`
- Move shared implementation under `internal/`
- Move `tables.ts` under `legacy/`
- Rename or relocate `model.ts`, `codec.ts`, and `zx.ts` so they no longer appear to be top-level public APIs

### Phase 3: Follow-up Cleanup

- Split `utils.ts`
- Revisit duplicated public model type-layer code
- Add boundary checks so public declaration files cannot reference internal modules again

## Practical Recommendations

1. Do not reorg blindly. The `root`/`core`/`full` overlap needs a naming decision first.
2. Treat `src/core/*` as compatibility-only, not architecture.
3. Treat `src/tables.ts` as `legacy/` immediately in the next pass.
4. Treat `src/model.ts`, `src/codec.ts`, and `src/zx.ts` as internal shared substrate, even if they stay in place briefly.
5. Add import-boundary checks after the reorg so public `.d.ts` files do not leak internals again.

