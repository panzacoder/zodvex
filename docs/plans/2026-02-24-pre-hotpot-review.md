# Pre-Hotpot Migration Review — `feat/codec-end-to-end`

**Branch:** `feat/codec-end-to-end` (83 commits, ~18.8k lines added)
**Purpose:** Validate that everything hotpot needs is correct before we start migrating.

This branch builds zodvex's full consumer layer on top of the existing codec DB infrastructure.

---

## Critical areas to review, in priority order

### 1. Codec boundary correctness at the consumer layer

The encode/decode pattern must be right everywhere or hotpot's security layer (which operates on decoded data) will break.

- `packages/zodvex/src/react/hooks.ts` — `useZodQuery` decodes returns via `schema.parse()`, `useZodMutation` encodes args via `z.encode()` + `stripUndefined()`. Is this correct for all codec types (dates, custom codecs like SensitiveField)?
- `packages/zodvex/src/client/zodvexClient.ts` — Same encode/decode pattern for vanilla client. Does `.subscribe()` correctly decode each update?
- `packages/zodvex/src/actionCtx.ts` — Wraps `ctx.runQuery`/`ctx.runMutation` with encode args + decode results. This is what hotpot's `za`/`zia` builders will use. Does the encode happen before the Convex wire boundary and decode after?

### 2. initZodvex registry integration

`packages/zodvex/src/init.ts` — The `registry` option is a lazy thunk (`() => AnyRegistry`) to break circular deps. When provided, action builders (`za`, `zia`) get wrapped with `createZodvexActionCtx`.

- Is the lazy thunk actually lazy (called at runtime, not import time)?
- Does `composeCodecAndUser()` correctly compose the codec customization with the user's action customization when both exist?
- The `AnyRegistry` type is duplicated in 4 files — not a correctness issue but worth noting.

### 3. Generated registry correctness

The codegen pipeline discovers models, functions, and codecs, then generates `_zodvex/api.ts` with a registry that maps function paths to `{ args, returns }` Zod schemas.

- `packages/zodvex/src/codegen/generate.ts` — Does `tryUnwrapToIdentity()` correctly handle `.nullable().optional()` ordering? Does it emit `TaskModel.schema.doc.nullable()` (preserving codec transforms) vs inline `z.object(...)` (losing them)?
- `packages/zodvex/src/codegen/zodToSource.ts` — The codec map identity matching. Is the `neededCodecImports` accumulator thread-safe across multiple `resolveSchema()` calls?
- `examples/task-manager/convex/_zodvex/api.ts` — The actual generated output. Verify `zDuration` references, model references for `.nullable()` returns, zero `z.any() /* unsupported */` remaining.

### 4. Monorepo structure

- Does `workspace:*` resolve correctly? (It does locally — but verify the lockfile makes sense)
- Release workflow: `cd packages/zodvex && npm publish` — does this work with npm's `--provenance` flag if we add it later?
- Are peer deps (zod, convex, convex-helpers) hoisted correctly for the example?

### 5. What's NOT on this branch (known gaps)

- `AnyRegistry` type duplicated 4x — should extract to `src/types.ts`
- `functionPath()` helper not extracted per spike recommendation
- No integration test that actually round-trips through encode → wire → decode with a real Convex backend
- `tasks:list` returns in the generated registry still has inline `z.object(...)` for the pagination wrapper (only the `page` array items get `TaskModel` treatment — the outer `{ page, isDone, continueCursor }` shape is ad-hoc)
