# Fix Codec Args Wire Types in Custom Builders — Design

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

In `custom.ts`, the `ArgsInput` type helper uses `z.input` (wire type) while the corresponding `ReturnValueOutput` type helper uses `z.output` (runtime type).

For ZodCodec schemas, `z.input` resolves to the wire schema's type (e.g., `{ value: string | null; status: "full" | "hidden" }`), while `z.output` resolves to the runtime type (e.g., `SensitiveField<string>`).

The `CustomBuilder` type uses `ArgsInput` for the `Registration` type's args parameter. Since hotpot's functions are built via `zCustomQuery` (which produces a `CustomBuilder`), the args in the published `FunctionReference._args` carry wire types.

Returns are unaffected because `ReturnValueOutput` already uses `z.output`.

### Why the initial theory was wrong

The earlier hypothesis blamed `containsCustom()` in `wrappers.ts` for skipping the Convex validator on returns but not args. Investigation showed that Convex validators play **zero role** in `_args`/`_returnType` — those types come entirely from zodvex's `RegisteredQuery` phantom params, which are derived from the `ArgsInput`/`ReturnValueOutput` type helpers.

## Fix

Change `z.input` to `z.output` in `ArgsInput` (`custom.ts` lines 55-61):

```typescript
// Before:
type ArgsInput<ArgsValidator extends ZodValidator | z.ZodObject<any> | void> = [
  ArgsValidator
] extends [z.ZodObject<any>]
  ? [z.input<ArgsValidator>]
  : [ArgsValidator] extends [ZodValidator]
    ? [z.input<z.ZodObject<ArgsValidator>>]
    : OneArgArray

// After:
type ArgsInput<ArgsValidator extends ZodValidator | z.ZodObject<any> | void> = [
  ArgsValidator
] extends [z.ZodObject<any>]
  ? [z.output<ArgsValidator>]
  : [ArgsValidator] extends [ZodValidator]
    ? [z.output<z.ZodObject<ArgsValidator>>]
    : OneArgArray
```

This is correct because callers pass runtime types — encoding to wire format happens inside the wrapper at runtime.

## Verification

1. `bun run type-check` — no type errors
2. `bun test` — all 837 tests pass
3. `bun run build` — build succeeds
4. Regenerate hotpot's `_zodvex/` and rebuild — `.d.ts` output shows `SensitiveField<string>` for args
