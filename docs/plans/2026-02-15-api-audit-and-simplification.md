# zodvex API Audit & Simplification Queue

**Date:** 2026-02-15
**Branch:** `fix/codec-issues`
**Context:** Full audit of zodvex's builder/wrapper API surface + hotpot consumer usage analysis. Queues up simplification work for a fresh context.

---

## Builder/Wrapper Function Inventory

zodvex has accumulated four layers of builder/wrapper functions. Understanding what each does (and doesn't do) is critical for the simplification.

### Layer 1: Raw Positional-Args Wrappers (`src/wrappers.ts`)

| Function | What it does |
|----------|-------------|
| `zQuery(builder, { args, handler, returns? })` | Wraps a Convex query builder with Zod validation on args/returns. ~80 lines. |
| `zMutation(...)` | Same for mutations. ~80 lines of duplicated code. |
| `zAction(...)` | Same for actions. ~80 lines of duplicated code. |
| `zInternalQuery/Mutation/Action(...)` | Internal variants. |

These are one-shot functions with positional-ish API. They do:
- Zod args parsing
- Zod returns validation
- Zod → Convex validator conversion
- `stripUndefined` on output
- Error handling with `ConvexError`

### Layer 2: Config-Object Adapters (`src/builders.ts`)

| Function | What it does |
|----------|-------------|
| `zQueryBuilder(builder)` | Returns a function that accepts `{ args, handler, returns }` config objects. Delegates to `zQuery`. |
| `zMutationBuilder(builder)` | Same, delegates to `zMutation`. |
| `zActionBuilder(builder)` | Same, delegates to `zAction`. |

These convert the positional API to a config-object API. They preserve full type inference via generics on the returned function.

### Layer 3: Custom Function Builders (`src/custom.ts` + `src/builders.ts`)

| Function | What it does |
|----------|-------------|
| `customFnBuilder(builder, customization)` | **The real engine.** Zod args validation, Zod returns validation, Zod → Convex conversion, `transforms.input`/`transforms.output`, `onSuccess` hooks, `stripUndefined`, custom context injection. |
| `zCustomQuery(builder, customization)` | Calls `customFnBuilder`. Returns `CustomBuilder` with full generic type inference. |
| `zCustomMutation(builder, customization)` | Same for mutations. |
| `zCustomAction(builder, customization)` | Same for actions. |
| `zCustomQueryBuilder(builder, customization)` | **Identical** to `zCustomQuery`. Pure duplication with different name. |
| `zCustomMutationBuilder(builder, customization)` | **Identical** to `zCustomMutation`. |
| `zCustomActionBuilder(builder, customization)` | **Identical** to `zCustomAction`. |
| `customCtxWithHooks(config)` | Creates customizations with `onSuccess` hooks and `transforms.input`/`transforms.output`. |

Key types:
- `CustomBuilder` — zodvex's callable type preserving full arg/return/ctx inference
- `CustomizationHooks` — `{ onSuccess }` (function boundary side effects)
- `CustomizationTransforms` — `{ input, output }` (function boundary data transforms)

### Layer 4: `initZodvex` Builders (`src/init.ts`) — NEW, PROBLEMATIC

| Function | What it does |
|----------|-------------|
| `buildHandler(baseBuilder, customCtxFn, wrapDb, hooks, config)` | **Reinvents `customFnBuilder` without any Zod validation.** Only does ctx augmentation + DB wrapping. |
| `createQueryBuilder(baseBuilder, zodTables, customCtxFn?, hooks?)` | Returns `DbBuilder` with `.withContext()` and `.withHooks()`. Uses `buildHandler`. |
| `createMutationBuilder(...)` | Same for mutations. |
| `createActionBuilder(...)` | Returns `ZodvexActionBuilder` (no `.withHooks()`). |
| `initZodvex(schema, server)` | Creates all builders, returns `{ zq, zm, za, ziq, zim, zia, zCustomCtx, zCustomCtxWithArgs }`. |
| `zCustomCtx(fn)` | Returns `{ _fn: fn }` — **incompatible** with convex-helpers' `customCtx` which returns proper `Customization` object. |
| `zCustomCtxWithArgs(config)` | Returns `{ _fn, _args }` — **dead code**, never used anywhere. |

---

## Critical Finding: `buildHandler` Has Zero Zod Validation

`buildHandler` in `init.ts` reimplemented `customFnBuilder` from scratch but omitted all Zod processing:

| Feature | `customFnBuilder` | `buildHandler` |
|---------|-------------------|----------------|
| Zod args parsing | Yes | **No** |
| Zod returns validation | Yes | **No** |
| Zod → Convex conversion | Yes | **No** |
| `transforms.input` | Yes | **No** |
| `transforms.output` | Yes | **No** |
| `onSuccess` hooks | Yes | **No** |
| `stripUndefined` | Yes | **No** |
| Custom context injection | Yes | Yes |
| DB wrapping | No | Yes |

**Impact:** Any function defined via `initZodvex`'s builders (`zq`, `zm`, etc.) gets zero Zod validation. The entire Zod pipeline is bypassed.

**Root cause:** The design phase focused on what was NEW (codec DB wrapping, database hooks) without inventorying what the EXISTING builders already do. `buildHandler` was written to solve the new concern and accidentally skipped the existing concerns.

---

## Two Different "Hooks" Systems

There are two completely different systems both called "hooks":

### 1. `CustomizationHooks` (function boundary — `src/custom.ts`)
- `onSuccess({ ctx, args, result })` — side effect after handler returns
- Used in `customCtxWithHooks`
- Lives at the **function** level (runs once per function call)

### 2. `DatabaseHooks` (DB boundary — `src/db/hooks.ts`)
- `decode.before.one/many` — filter/transform raw docs before codec decode
- `decode.after.one/many` — transform decoded docs after codec decode
- `encode.before` — transform/validate before codec encode (insert/patch/delete)
- Lives at the **database** level (runs per DB operation)

These serve completely different purposes at different layers. The naming overlap is confusing.

---

## Hotpot Consumer Usage Analysis

### What Hotpot Uses from zodvex

| API | Usage |
|-----|-------|
| `zQueryBuilder` | Base query builder (bound to `query` from `_generated/server`) |
| `zCustomQueryBuilder` | Auth-secured query builder with context injection |
| `zMutationBuilder` | Base mutation builder |
| `zCustomMutationBuilder` | Auth-secured mutation builder with context injection |
| `zActionBuilder` | Base action builder |
| `zCustomActionBuilder` | Auth-secured action builder |
| `transforms.output` | Audit logging — runs BEFORE Zod validation to preserve `SensitiveField` metadata |
| `zx.codec()` | Custom codecs (e.g., `SensitiveField`) |
| `zx.date()`, `zx.id()` | Standard codecs |
| `zodToConvexFields` | Schema conversion |
| `ZodvexCodec` type | Type import for codec definitions |

### What Hotpot Does NOT Use

| API | Why Not |
|-----|---------|
| `initZodvex` | Not available when hotpot was written; hotpot binds builders manually |
| `zodTable` | Hotpot defines tables directly with Convex's `defineTable` |
| `defineZodSchema` | Same — hotpot uses Convex's `defineSchema` directly |
| `createZodDbReader/Writer` | New; hotpot already wraps `ctx.db` inside customization `input` |
| `createDatabaseHooks` / `composeHooks` | New; not yet integrated |
| `decodeDoc` / `encodeDoc` | New primitives |
| `customCtxWithHooks` | Hotpot builds customizations manually, doesn't use this helper |
| `zCustomCtxWithArgs` | Dead code, unused everywhere |

### Hotpot's DB Wrapping Pattern

Hotpot already wraps `ctx.db` inside the customization's `input` function — exactly the pattern `initZodvex` should use:

```typescript
// hotpot's pattern (simplified)
const secureQuery = zCustomQueryBuilder(query, {
  args: {},
  input: async (ctx, args) => {
    const securityCtx = await buildSecurityContext(ctx)
    return {
      ctx: {
        ...securityCtx,
        db: createSecureReader(ctx.db, securityCtx) // wraps ctx.db here
      }
    }
  }
})
```

### Hotpot's `transforms.output` Usage

Hotpot uses `transforms.output` for audit logging. This transform runs **before** Zod validation, which is critical because it needs access to `SensitiveField` instances (custom codec objects) before they get serialized to wire format by the Zod pipeline.

This ordering dependency means `transforms.output` cannot simply be replaced with a "post-validation" hook. The transform intentionally runs at a specific point in the Zod pipeline.

---

## `.withContext()` + `.withHooks()` API Coherence Concern

The current API chains `.withContext()` and `.withHooks()` on the same builder:

```typescript
const adminQuery = zq.withContext(authCtx).withHooks(adminHooks)
```

But these describe modifications to **different layers**:
- `.withContext()` modifies the **function context** (auth, permissions, etc.)
- `.withHooks()` modifies the **database wrapper** (decode/encode hooks)

This is confusing because the chain looks like it's configuring one thing, but it's actually configuring two different things at different points in the request lifecycle.

**Proposed direction:** DB hooks should travel WITH the context customization, since they're naturally coupled — hotpot's security hooks depend on the auth context that the customization provides.

---

## Agreed-Upon Architecture for Redesign

### Two Pipelines, One Composition Layer

1. **Function-level pipeline** (`customFnBuilder` — existing, keep):
   - Zod args validation → `transforms.input` → handler → `transforms.output` → Zod returns validation → `stripUndefined` → `onSuccess`

2. **DB-level pipeline** (`createZodDbReader/Writer` — new, keep):
   - Reads: `decode.before` hooks → codec decode (`decodeDoc`) → `decode.after` hooks
   - Writes: `encode.before` hooks → codec encode (`encodeDoc`) → DB write

3. **Composition layer** (`initZodvex` — needs redesign):
   - Should delegate to `customFnBuilder`/`zCustomQuery`, NOT reinvent the pipeline
   - DB wrapping injected through customization's `input` function (where `ctx.db` gets replaced)
   - `.withContext()` composes user customization on top of codec customization

### Key Insight: Zod is a Pipeline

Zod doesn't "validate then optionally transform." It processes data through a pipeline and guarantees an output shape. Both boundaries (function and DB) do the same thing — run data through a Zod pipeline. The codec step IS the validation step.

---

## Simplification Queue

### Must Fix (Correctness)

1. **Redesign `initZodvex` to delegate to `customFnBuilder`** — current implementation has zero Zod validation. This is the highest priority fix.

2. **Make builders generic over DataModel** (Task #62) — consumers get no type inference for `ctx.db` or args. Must build on `customFnBuilder`'s `CustomBuilder` type, not the current `DbBuilder`/`ZodvexActionBuilder` which use `any`.

### Should Fix (API Coherence)

3. **Eliminate `zCustomQueryBuilder`/`zCustomMutationBuilder`/`zCustomActionBuilder` duplication** — identical to `zCustomQuery`/etc. Pick one name.

4. **Remove `zCustomCtx` / `zCustomCtxWithArgs`** — `zCustomCtx` returns `{ _fn: fn }` which is incompatible with everything. Replace with convex-helpers' `customCtx` or make compatible.

5. **Resolve `.withContext()` + `.withHooks()` API** — either make hooks travel with customization or find an API that makes the two-layer nature explicit.

6. **Disambiguate "hooks" naming** — `CustomizationHooks` (function boundary) vs `DatabaseHooks` (DB boundary) are confusing. Consider renaming one.

### Should Assess (Possible Deprecation)

7. **Assess `transforms.input`/`transforms.output` vs DB hooks** — original plan noted these might be deprecated in favor of DB-level hooks. But hotpot's `transforms.output` usage (audit logging before Zod validation) shows they serve a different purpose. Need to determine if both systems are needed or if they can be unified.

8. **Assess Layer 1 (`zQuery`/`zMutation`/`zAction`)** — ~240 lines of duplicated code. `customFnBuilder` does everything these do plus more. Can these be replaced by `customFnBuilder` with `NoOp` customization?

### Cleanup

9. **Remove `zCustomCtxWithArgs`** (Task #57) — dead code, unused everywhere.
10. **Document replace-vs-compose semantics** (Task #59) — `.withContext()` and `.withHooks()` replace, not compose.
11. **Document that hooks receive raw ctx.db** (Task #60) — hooks see the unwrapped Convex db, not the codec-wrapped one.
