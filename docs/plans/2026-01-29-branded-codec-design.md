# Type-Level Support for Custom Codec Registration

**Date:** 2026-01-29
**Status:** Ready for implementation

## Problem

When consumers create custom codecs using `z.codec()` and wrap them with a type alias for better DX, zodvex's `ConvexValidatorFromZod` type fails to recognize them as codecs because the type alias erases the `ZodCodec<A, B>` structural information.

```typescript
// Consumer wants nice IDE display
export type SensitiveCodec<T> = z.ZodType<SensitiveField<T>, SensitiveWire<T>>

export function sensitive<T>(inner: T): SensitiveCodec<T> {
  const codec = z.codec(wireSchema, fieldSchema, { decode, encode })
  return codec as SensitiveCodec<T>  // Cast loses ZodCodec structure
}
```

**Result:** `ConvexValidatorFromZod` checks `Z extends z.ZodCodec<infer A, any>` which fails because `SensitiveCodec<T>` is typed as `z.ZodType`, not `z.ZodCodec`. Falls back to `VAny<'required'>`.

**Root cause:** This is purely a type-level issue. At runtime, the object IS a `ZodCodec` instance with correct `_zod.def.in` (wire schema). But TypeScript's conditional type only sees the declared type alias, not the runtime value.

## Solution

Add a branded codec type that preserves wire schema information through type aliases via a phantom type brand.

### Core Types (src/types.ts)

```typescript
/**
 * Brand symbol for preserving wire schema type through type aliases.
 */
declare const ZodvexWireSchema: unique symbol
export { ZodvexWireSchema }

/**
 * A branded ZodCodec that preserves wire schema type information.
 */
export type ZodvexCodec<
  Wire extends z.ZodTypeAny,
  Runtime extends z.ZodTypeAny
> = z.ZodCodec<Wire, Runtime> & {
  readonly [ZodvexWireSchema]: Wire
}
```

### Helper Function (src/codec.ts)

```typescript
import { type ZodvexCodec } from './types'

/**
 * Creates a branded ZodCodec for use with zodvex type inference.
 * Thin wrapper around z.codec() that adds type branding.
 */
export function zodvexCodec<
  W extends z.ZodTypeAny,
  R extends z.ZodTypeAny
>(
  wire: W,
  runtime: R,
  transforms: {
    decode: (wire: z.output<W>) => z.output<R>
    encode: (runtime: z.output<R>) => z.input<W>
  }
): ZodvexCodec<W, R> {
  return z.codec(wire, runtime, transforms) as ZodvexCodec<W, R>
}

// Re-export for convenience
export { ZodvexCodec } from './types'
```

### Type System Integration (src/mapping/types.ts)

Add branded codec check **before** the native `z.ZodCodec` check in both `ConvexValidatorFromZodBase` and `ConvexValidatorFromZod`:

```typescript
import type { ZodvexWireSchema } from '../types'

// In ConvexValidatorFromZodBase, add BEFORE the ZodCodec check:
: Z extends { readonly [ZodvexWireSchema]: infer W extends z.ZodTypeAny }
  ? ConvexValidatorFromZodBase<W>
  : Z extends z.ZodCodec<infer A extends z.ZodTypeAny, any>
    ? ConvexValidatorFromZodBase<A>
    : VAny<'required'>

// In ConvexValidatorFromZod, add BEFORE the ZodCodec check:
: Z extends { readonly [ZodvexWireSchema]: infer W extends z.ZodTypeAny }
  ? ConvexValidatorFromZod<W, Constraint>
  : Z extends z.ZodCodec<infer A extends z.ZodTypeAny, any>
    ? ConvexValidatorFromZod<A, Constraint>
    : VAny<'required'>
```

## File Changes

| File | Change |
|------|--------|
| `src/types.ts` | ADD: `ZodvexWireSchema` symbol, `ZodvexCodec` type |
| `src/codec.ts` | ADD: `zodvexCodec` function, re-export `ZodvexCodec` |
| `src/mapping/types.ts` | MODIFY: import symbol, add branded check to conditionals |
| `src/index.ts` | No changes (already exports from types.ts and codec.ts) |
| `__tests__/branded-codec.test.ts` | ADD: new test file |

## Consumer Usage

```typescript
import { ZodvexCodec, zodvexCodec } from 'zodvex'

// Define wire/runtime type aliases
type SensitiveWire<T extends z.ZodTypeAny> = z.ZodObject<{
  value: z.ZodNullable<T>
  status: z.ZodOptional<z.ZodEnum<['full', 'hidden']>>
  reason: z.ZodOptional<z.ZodString>
  __sensitiveField: z.ZodOptional<z.ZodString>
}>

type SensitiveRuntime<T extends z.ZodTypeAny> = z.ZodCustom<SensitiveField<z.output<T>>>

// Clean type alias for IDE display
export type SensitiveCodec<T extends z.ZodTypeAny> = ZodvexCodec<
  SensitiveWire<T>,
  SensitiveRuntime<T>
>

// Factory function with explicit return type
export function sensitive<T extends z.ZodTypeAny>(inner: T): SensitiveCodec<T> {
  const wireSchema = z.object({
    value: inner.nullable(),
    status: z.enum(['full', 'hidden']).optional(),
    reason: z.string().optional(),
    __sensitiveField: z.string().optional(),
  })

  const fieldSchema = z.custom<SensitiveField<z.output<T>>>(...)

  const codec = zodvexCodec(wireSchema, fieldSchema, {
    decode: (wire) => { ... },
    encode: (field) => { ... },
  })

  // Consumer's own metadata registration (not zodvex's concern)
  sensitiveMetadata.set(codec, { inner })

  return codec
}
```

**IDE hover result:** `SensitiveCodec<z.ZodString>` instead of verbose `z.ZodCodec<z.ZodObject<...>, ...>`

## Testing Strategy

1. **Type-level:** Branded codec extracts wire schema through type alias
2. **Type-level:** Native `z.ZodCodec` backwards compatibility
3. **Runtime:** `zodvexCodec` creates functional codec (encode/decode work)
4. **Runtime:** `zodToConvex` produces correct validator structure

## Design Decisions

1. **Pure wrapper (no callback):** `zodvexCodec` is a thin wrapper around `z.codec()` with only type branding. Metadata registration is the consumer's concern.

2. **Symbol in types.ts:** Keeps types with types, runtime with runtime. No circular dependency risk.

3. **Brand check before native check:** Ensures branded codecs match first, with native `z.ZodCodec` as fallback for backwards compatibility.

## Acceptance Criteria

- [ ] `ZodvexCodec<Wire, Runtime>` type exported
- [ ] `zodvexCodec()` helper function exported
- [ ] `ConvexValidatorFromZod` recognizes branded codecs and extracts wire schema
- [ ] Type alias using `ZodvexCodec` shows clean name in IDE hover
- [ ] Existing `z.ZodCodec` detection still works (backwards compatible)
- [ ] Tests verify type inference works through branded type aliases
