# Release Blockers for feat/codec-end-to-end

Three fixes required before merging the codec end-to-end branch to main.

## Prerequisite: Type tests are not in tsconfig scope

The existing `packages/zodvex/typechecks/` directory is excluded from type-checking — `tsconfig.json` only includes `src/**/*.ts`. The `.test-d.ts` files there are currently inert.

**Fix:** Add a `tsconfig.typecheck.json` that extends the base and includes `typechecks/`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "noEmit": true },
  "include": ["src/**/*.ts", "typechecks/**/*.test-d.ts"]
}
```

Update the `type-check` script in `package.json` to use it: `tsc --noEmit -p tsconfig.typecheck.json`.

This affects all three blockers since they rely on type tests for regression protection.

---

## Blocker 1: `zx.codec()` decoupled transform inference

### Problem

When a codec's wire schema depends on an unresolved generic (e.g., a factory function `sensitive<T>(inner: T)` that builds a codec from `T`), TypeScript can't resolve `z.output<W>` at the call site. The transform callback parameters lose their types and callers are forced to cast to `any`.

### Design

Replace the current signature in both `src/zx.ts` and `src/codec.ts` with a 4-type-param signature:

```typescript
function codec<
  W extends z.ZodTypeAny,
  R extends z.ZodTypeAny,
  WO = z.output<W>,
  RI = z.output<R>
>(
  wire: W,
  runtime: R,
  transforms: {
    decode: (wire: WO) => RI
    encode: (runtime: RI) => WO
  }
): ZodvexCodec<W, R>
```

- `W`/`R` are inferred from the schema arguments, preserving `ZodvexCodec<W, R>` branding for downstream type extraction.
- `WO`/`RI` default to `z.output<W>` / `z.output<R>` for the happy path (inference works). When TS can't resolve them (generic wire schema), the caller annotates the callback params and `WO`/`RI` are inferred from those annotations instead.
- No overloads, no explicit type params needed at call sites. Pure inference both ways.

### Note on `z.input` vs `z.output` simplification

The current signatures use `z.output<W>` for decode input but `z.input<R>` for decode output (and vice versa for encode). This captures the input/output distinction for schemas with transforms. The new signature simplifies to `WO`/`RI` without that distinction. For schemas without transforms (the common case), `z.input === z.output` so this is a no-op. For schemas with transforms, the caller's annotations drive inference anyway, so the distinction is preserved implicitly by what the caller writes.

### Trade-off

The compile-time constraint that `WO === z.output<W>` is relaxed. A caller could write mismatched transform types that compile but fail at runtime. This is acceptable because callers in this situation are already casting to `any` today — this gives them a path that preserves return type branding.

### Affected files

- `packages/zodvex/src/zx.ts` — `codec()` signature change (line 131-140)
- `packages/zodvex/src/codec.ts` — `zodvexCodec()` signature change (line 99-106). Must be updated because `zx.codec()` delegates to it; leaving the old constrained signature would re-constrain the types.

### Type tests

New file `packages/zodvex/typechecks/codec-inference.test-d.ts`:

1. Standard codec (`zx.date()` pattern) — verify `WO`/`RI` infer from defaults, no regressions
2. Direct `zodvexCodec()` call — verify inner function also infers correctly
3. Generic factory function with unresolved `T` — verify annotated callback params drive inference, return type is `ZodvexCodec<W, R>`

---

## Blocker 2: `za.withContext()` action context collapse — verification

### Problem

`za.withContext()` was reported to type the handler's `ctx` as `{ [k: string]: never }` instead of `GenericActionCtx<DM>`. Root cause: `Overwrite<ActionCtx, Record<string, never>>` collapsed all properties via `Omit<Ctx, string>` because `Record<string, never>` has `keyof = string`.

### Current state

Two fixes already exist on this branch:
- `NoCodecCtx = {}` type alias (init.ts:56) — `{}` has `keyof = never`, so `Overwrite` passes through
- `Overwrite<T, U>` guard clause (types.ts:130) — `keyof U extends never ? T : Omit<T, keyof U> & U`

Both fixes are present since beta.28 (120+ commits ago). Hotpot is on beta.50 and the TODO comment may be stale. We need type-level tests to confirm the fix and prevent regression.

### Design

**Type test** — new file `packages/zodvex/typechecks/action-context.test-d.ts`:

1. `za.withContext()` with a customization that adds `{ securityCtx: string }` to ctx — assert that specific properties are accessible on the handler's `ctx`: `ctx.auth` (from `GenericActionCtx`), `ctx.securityCtx` (from customization). Use property-level assertions rather than full ctx equality to avoid brittleness with `GenericActionCtx<DM>`.
2. `za({...})` directly (no withContext) — assert `ctx.auth` is accessible (proves ctx is not collapsed to `{ [k: string]: never }`)

Uses `Expect<Equal<...>>` on specific properties so `bun run type-check` catches regressions.

**Example app** — add a simple action in `examples/task-manager/convex/` that uses `za.withContext()` to add a property to ctx, then accesses it in the handler. Exercises the type in a real consumer context.

### Affected files

- `packages/zodvex/typechecks/action-context.test-d.ts` — new type test
- `examples/task-manager/convex/` — new action with `.withContext()`

### Outcome

If type-check passes: fix is confirmed, hotpot's TODO is stale, no code changes needed.
If type-check fails: we've caught a live bug and will investigate the failing path.

---

## Blocker 3: Union index encoding

### Problem

`encodeIndexValue()` in `src/db.ts` only handles `ZodObject` schemas. When a table uses a top-level union (discriminated or otherwise), the function falls through to `return value` without encoding. Codec fields (like `zx.date()`) in `.withIndex()` comparisons on union tables silently skip encoding — a `Date` would be sent where Convex expects a `number`. This passes in convex-test (lenient) but breaks on a real backend.

### Design

Extend `encodeIndexValue` with a `ZodUnion` branch using Zod v4's public API:

```typescript
function encodeIndexValue(schema: z.ZodTypeAny, fieldPath: string, value: any): any {
  // Dot-paths target wire-format sub-fields — value is already correct
  if (fieldPath.includes('.')) return value

  // Object schemas: encode through the field's schema directly
  if (schema instanceof z.ZodObject) {
    const fieldSchema = (schema as z.ZodObject<any>).shape[fieldPath]
    if (fieldSchema) return z.encode(fieldSchema, value)
  }

  // Union schemas (ZodDiscriminatedUnion extends ZodUnion): build a per-field
  // union from all variants, then encode through that. This handles:
  // - Discriminator literals: z.union([z.literal('a'), z.literal('b')]) accepts either
  // - Codec fields: z.union([zx.date(), zx.date()]) encodes Date → number
  // Non-object variants are silently skipped — consistent with union table
  // constraints where all variants must be objects.
  // If no variants contain the field, falls through to return value unchanged
  // (same behavior as the object path when field is missing from shape).
  if (schema instanceof z.ZodUnion) {
    const fieldSchemas = (schema as z.ZodUnion).options
      .filter((v): v is z.ZodObject<any> => v instanceof z.ZodObject)
      .map((v) => v.shape[fieldPath])
      .filter(Boolean)
    if (fieldSchemas.length === 1) return z.encode(fieldSchemas[0], value)
    if (fieldSchemas.length > 1)
      return z.encode(
        z.union(fieldSchemas as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]),
        value
      )
  }

  return value
}
```

**Public API only:**
- `instanceof z.ZodUnion` — catches both `ZodUnion` and `ZodDiscriminatedUnion` (subclass)
- `.options` — public property on `ZodUnion`, returns the variant array
- `instanceof z.ZodObject` + `.shape` — public property for object field schemas
- `z.encode()`, `z.union()` — public Zod v4 functions

No `_zod.def` access. No caching (premature for index queries).

### Affected files

- `packages/zodvex/src/db.ts` — `encodeIndexValue` function (~15 lines added)

### Tests

`encodeIndexValue` is module-private, so tests go through `ZodvexQueryChain.withIndex()`. New tests in `packages/zodvex/__tests__/db.test.ts` (following the existing `withIndex encoding` test pattern at lines 599-674):

- Discriminator field index on union table — encode discriminator literals through per-field union
- Codec field (`zx.date()`) index on union table — encode `Date` → `number` through per-field union
- Compound index with mixed discriminator + codec fields
- Non-codec field on union table — passthrough unchanged

Existing integration tests in `examples/task-manager/convex/notifications.test.ts` and `withIndex.test.ts` also exercise this path once the `import.meta.glob` issue is fixed (separate concern).
