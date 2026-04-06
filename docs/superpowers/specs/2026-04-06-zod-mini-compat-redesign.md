# zod/mini Compatibility Redesign

> Supersedes: `2026-04-02-full-mini-mode-design.md`

## Problem

zodvex promises zod/mini compatibility via `zodvex/mini`, but there are type-level bugs that break it. At runtime, the build IS correct — `tsup.config.ts` has a `zodMiniAliasPlugin` esbuild plugin that rewrites `import { z } from 'zod'` → `import { z } from 'zod/mini'` for the mini build. The built `dist/mini/index.js` correctly imports from `'zod/mini'`. However:

### What breaks

1. **Type declarations are wrong**: `mini/index.ts:112` references bare `ZodObject` (not imported, not `$ZodObject` or `ZodMiniObject`), causing a tsc error. The `InsertSchema` generic parameter uses a full-zod type while `Schemas` uses `MiniModelSchemas` — a mismatch that cascades into 33 type errors in task-manager-mini (every `.withIndex()`, `.eq()`, `.gt()`, `.lt()` call fails because Convex can't extract field types).

2. **No `zodvex/mini/server` entrypoint**: Server modules (builders, db, wrappers, init) are not built with the mini alias. Consumers using zod/mini on the server get full-zod objects from server APIs.

3. **Tests don't catch any of this**: The dual test suite's Vite plugin transforms test source code but never touches zodvex's compiled library code. Tests prove type compatibility but not runtime correctness or type declaration accuracy.

### Root cause

The mini entrypoint (`src/mini/index.ts`) re-exports functions from core modules with `as any` casts and manually-written type overrides. These overrides are incomplete/buggy. The build-time alias handles the runtime correctly, but tsc generates `.d.ts` files from source (not built output), so the type declarations still reference full-zod types.

### Key discovery: build-time alias already works

```ts
// tsup.config.ts — already in place
const zodMiniAliasPlugin: Plugin = {
  name: 'alias-zod-to-mini',
  setup(build) {
    build.onResolve({ filter: /^zod$/ }, () => ({
      path: 'zod/mini',
      external: true,
    }))
  },
}
```

Verified: `dist/mini/index.js` contains `import { z } from 'zod/mini'` and zero occurrences of `"zod"` (full). The runtime is correct.

## Goal

1. Fix the type declarations so `zodvex/mini` exports correct mini-typed schemas
2. Add `zodvex/mini/server` entrypoint with the same build-time alias
3. Eliminate the 33 type errors in task-manager-mini
4. Add test infrastructure that catches type and runtime regressions

## Design

### Fix 1: Type declarations in `mini/index.ts`

The `defineZodModel` overload on line 112 must use `$ZodObject<Fields>` (from `zod/v4/core`) as the `InsertSchema` type — not the undefined bare `ZodObject`. This works because:

- `ModelFieldPaths<InsertSchema>` constrains `InsertSchema extends $ZodType` — `$ZodObject` satisfies this
- `ConvexValidatorFromZodFieldsAuto<F>` operates on `model.fields` (typed as `$ZodShape`), not `InsertSchema`
- `ConvexTableFor<E>` in `schema.ts` extracts `fields: infer F extends Record<string, $ZodType>` — core-typed

The `MiniModelSchemas` type also needs review — each schema property should use types from `zod/v4/core` (e.g., `$ZodObject`) rather than `ZodMiniObject` from `zod/mini`, since the `.d.ts` is generated from source where the runtime objects come from whatever `z` the build alias provides.

### Fix 2: Add `zodvex/mini/server` entrypoint

Create `src/mini/server/index.ts` that re-exports from `../server/index.ts` (same pattern as the existing mini entrypoint). Add it to:
- `tsup.config.ts` mini build config (entry + alias plugin)
- `package.json` exports map

### Fix 3: Test infrastructure

1. **Type-check examples in CI**: Run `tsc --noEmit` on `examples/task-manager-mini/` to catch type errors like the current 33 failures.

2. **Runtime assertion tests**: Verify schemas from `zodvex/mini` are actual mini instances (not full-zod). Test that `model.schema.doc` is an `instanceof $ZodObject` and that it was created by zod/mini (e.g., check property count or prototype).

3. **Import isolation test**: A vitest plugin that intercepts `import 'zod'` (full) and throws when running in mini mode — any accidental full-zod import in the mini path fails immediately.

## Modules: what changes

### Must change

| File | Change | Why |
|---|---|---|
| `src/mini/index.ts` | Fix `InsertSchema` type, review `MiniModelSchemas` | Type bug: bare `ZodObject` undefined |
| `src/mini/server/index.ts` | **Create** — mini server entrypoint | No mini server path exists |
| `packages/zodvex/tsup.config.ts` | Add mini/server entry to mini build | Build the new entrypoint with alias |
| `packages/zodvex/package.json` | Add `./mini/server` to exports map | Expose new entrypoint |

### No changes needed

| File | Why |
|---|---|
| All 16 files with `import { z } from 'zod'` | Build-time alias handles runtime rewriting |
| `mapping/core.ts`, `mapping/types.ts` | Already use `zod/v4/core` |
| `schema.ts`, `types.ts`, `init.ts` | `import type` only |
| `zod-core.ts` | Re-exports from `zod/v4/core` |

### New test files

| File | Purpose |
|---|---|
| `__tests__/mini-types.test.ts` | Type-level tests for mini model schemas |
| `__tests__/mini-runtime.test.ts` | Runtime assertions: mini instances produced |

## convex-helpers

convex-helpers does NOT transitively import from `'zod'`. Its exports used by zodvex:
- `Customization`, `NoOp`, `customCtx` from `convex-helpers/server/customFunctions` — no zod dependency
- `Table` from `convex-helpers/server` — only used in `tables.ts` (not in mini path)

No changes needed.

## Scope exclusions

- **-impl refactoring**: NOT needed. Build-time alias handles runtime. Only type declarations need fixing.
- **`tables.ts` mini support**: Legacy module, excluded.
- **`form/mantine/` mini support**: Deferred.
- **Compilation step**: Deferred pending Convex pre-build hooks.
- **`zodvex/react` and `zodvex/client` mini variants**: These consume schemas but don't construct them. Should work with either entrypoint without changes, but should be verified.
