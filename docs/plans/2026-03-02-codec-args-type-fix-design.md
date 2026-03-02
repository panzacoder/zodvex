# Skip Convex Args Validator for Codec Schemas — Design

## Problem

When a zodvex function uses codec-typed args (e.g., `SensitiveField`), the consumer-facing `.d.ts` types args as wire format instead of runtime format:

```typescript
// Actual output (wrong):
usePatientByEmail: (args: "skip" | {
    email: { value: string | null; status: "full" | "hidden"; ... };
}) => ...

// Expected (correct):
usePatientByEmail: (args: "skip" | {
    email: SensitiveField<string>;
}) => ...
```

Meanwhile, return types correctly show `SensitiveField<string>`. The asymmetry causes type errors when consumers pass runtime types to codec-aware hooks.

## Root Cause

In `wrappers.ts`, zodvex's `zQuery`/`zMutation`/`zAction` pass both args and returns validators to the Convex builder. Convex's `ApiFromModules` uses validator types for `FunctionReference._args` and `._returnType`.

For **returns**, there's an existing `containsCustom()` check that skips the Convex validator when the schema contains `z.custom` types (codecs use `z.custom` for runtime schemas). Without a validator, `ApiFromModules` falls back to zodvex's declared `RegisteredQuery<V, ..., Promise<InferReturns<R>>>` phantom types, which use `z.output` = runtime types.

For **args**, no such skip exists. `zodToConvexFields()` always produces a Convex validator carrying wire types, which `ApiFromModules` uses, overriding zodvex's declared runtime types.

## Fix

Apply the same `containsCustom` treatment to args. When the Zod args schema contains codec/custom types, pass `args: {}` to the Convex builder instead of wire-typed validators.

### Runtime Safety

zodvex already validates args through `zodSchema.parse(argsObject)` in the handler (wrappers.ts line 110). The Convex validator is redundant for codec-containing schemas. Non-codec schemas are unaffected — their Convex validators continue to work normally.

### Type Effect

Without a Convex validator constraining the args type, `ApiFromModules` uses zodvex's declared `RegisteredQuery<V, ZodToConvexArgs<A>, ...>` where `ZodToConvexArgs<A>` uses `z.output<A>` = runtime types. This is exactly how returns already work.

## Scope

### Change: `packages/zodvex/src/wrappers.ts`

In `zQuery`, `zMutation`, `zAction` (and their `zInternal*` variants), add `containsCustom` check for args:

```typescript
// Before (zQuery, ZodObject branch):
args = zodToConvexFields(getObjectShape(zodObj))

// After:
args = containsCustom(zodObj) ? {} : zodToConvexFields(getObjectShape(zodObj))
```

Same pattern for the `Record<string, z.ZodTypeAny>` branch and single-schema branch. The `zInternal*` variants delegate to the main functions, so they inherit the fix.

### Test

Verify that functions with codec args produce runtime-typed function references in the declared return type.

### Verification

1. `bun test` — existing tests pass
2. `bun run build` — build succeeds
3. `bun run type-check` — no type errors
4. Regenerate hotpot's `_zodvex/` and rebuild — `.d.ts` output shows `SensitiveField<string>` for args
