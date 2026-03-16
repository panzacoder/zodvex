# `zx.codec` explicit type parameter overloads

## Problem

When a codec's wire schema depends on an unresolved generic, TypeScript can't infer `z.output<W>` and fields drop out of the decode/encode callback types.

**Concrete example from hotpot's `sensitive<T>()`:**

```typescript
function sensitive<T extends z.ZodTypeAny>(inner: T) {
  const wireSchema = z.object({
    value: inner.nullable(),  // ← depends on generic T
    status: z.enum(['full', 'hidden']),
    // ...
  })

  // TypeScript can't resolve z.output<typeof wireSchema> here
  // because inner.nullable() depends on unresolved T.
  // The `value` field drops out entirely.
  const codec = zx.codec(wireSchema, fieldSchema, {
    decode: (wire: any) => { ... },  // ← forced to cast `any`
    encode: (field: any) => { ... }, // ← forced to cast `any`
  })
}
```

## Current signature

```typescript
// src/zx.ts:131-140
function codec<W extends z.ZodTypeAny, R extends z.ZodTypeAny>(
  wire: W,
  runtime: R,
  transforms: {
    decode: (wire: z.output<W>) => z.input<R>
    encode: (runtime: z.output<R>) => z.input<W>
  }
): ZodvexCodec<W, R>
```

Only inference-based — no way to supply explicit types when inference fails.

## Proposed fix: explicit type parameter overload

Add an overload that lets callers specify `WireOutput` and `RuntimeOutput` explicitly:

```typescript
// New overload for when inference fails (generic wire schemas)
function codec<WireOutput, RuntimeOutput>(
  wire: z.ZodTypeAny,
  runtime: z.ZodTypeAny,
  transforms: {
    decode: (wire: WireOutput) => RuntimeOutput
    encode: (runtime: RuntimeOutput) => WireOutput
  }
): ZodvexCodec<z.ZodTypeAny, z.ZodTypeAny>

// Existing inference-based signature (unchanged)
function codec<W extends z.ZodTypeAny, R extends z.ZodTypeAny>(
  wire: W,
  runtime: R,
  transforms: {
    decode: (wire: z.output<W>) => z.input<R>
    encode: (runtime: z.output<R>) => z.input<W>
  }
): ZodvexCodec<W, R>
```

**Hotpot usage after fix:**

```typescript
type WireShape = { value: z.output<T> | null; status: 'full' | 'hidden'; ... }

const codec = zx.codec<WireShape, SensitiveField<z.output<T>>>(
  wireSchema, fieldSchema, {
    decode: (wire) => { /* wire.value is now typed */ },
    encode: (field) => { /* field is SensitiveField<...> */ },
  }
)
```

## Scope

- [ ] Add overload signature to `zx.codec()` in `src/zx.ts`
- [ ] Add overload to `zodvexCodec()` in `src/codec.ts` if needed
- [ ] Add test exercising the overload with a generic wire schema
- [ ] Verify existing inference-based callers are unaffected (overload ordering)

## Level of effort

Low — purely type-level change, no runtime modifications. 2-4 hours including testing.

## Risks

- TypeScript overload resolution is order-sensitive — need to ensure the explicit overload is only selected when type params are provided, not when they'd be inferred as `unknown`
- May need a branded/tagged approach to disambiguate the overloads

## Related

- `todo/hotpot-any-audit.md` — item 1
- `src/zx.ts:131-140` — current implementation
- `src/codec.ts:99-112` — underlying `zodvexCodec()`
- hotpot `convex/hotpot/security/sensitive.ts` — the consumer
