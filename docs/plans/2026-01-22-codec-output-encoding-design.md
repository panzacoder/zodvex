# Zod 4 Codec Support for Output Validation

**Date:** 2026-01-22
**Status:** Approved

## Problem

When a `returns` schema contains Zod 4 codecs, the current `parse()` call runs the codec's `decode` direction (wire → runtime), but for output validation we need the `encode` direction (runtime → wire).

```ts
// A codec that transforms wire ↔ runtime
const sensitiveCodec = z.codec(wireSchema, runtimeSchema, {
  decode: (wire) => new RuntimeClass(wire),  // wire → runtime
  encode: (runtime) => runtime.toWire(),     // runtime → wire
})

// Current zodvex flow for returns:
// 1. Handler returns RuntimeClass instance
// 2. transforms.output converts to wire format (optional)
// 3. parse() runs — but this DECODES wire back to RuntimeClass!
// 4. Type mismatch and broken data
```

## Solution

Replace `parse()` with `z.encode()` for output validation. This is a minimal change in two locations within `src/custom.ts`.

### Current flow (broken for codecs)

```
Handler returns → transforms.output → parse() [DECODE] → toConvexJS()
                                         ↑ WRONG direction
```

### Fixed flow

```
Handler returns → transforms.output → z.encode() [ENCODE] → toConvexJS()
                                         ↑ CORRECT direction
```

## Implementation

### Changes to `src/custom.ts`

**Line ~391** (with-args path):
```ts
// Before
validated = (returns as z.ZodTypeAny).parse(preTransformed)

// After
validated = z.encode(returns as z.ZodTypeAny, preTransformed)
```

**Line ~449** (no-args path):
```ts
// Before
validated = (returns as z.ZodTypeAny).parse(preTransformed)

// After
validated = z.encode(returns as z.ZodTypeAny, preTransformed)
```

## Behavior

| Schema type | `z.encode()` behavior |
|-------------|----------------------|
| Non-codec fields | Pass through with validation |
| Codec fields | Run `encode` transform + validation |
| Mixed schemas | Each field handled appropriately |

### Verified behaviors

- `z.encode()` works with mixed codec/non-codec schemas
- Non-codec fields pass through unchanged with validation
- Codec fields run their `encode` transform
- Validation still enforced (refinements, type checks, required fields)
- Throws `ZodError` on failure (same as `parse()`)

## What stays the same

- `transforms.output` still runs before encoding (users can stop using it for codec schemas)
- `transforms.input` unchanged
- Error handling unchanged (`handleZodValidationError`)
- Type inference unchanged (already correct: handler returns `z.output`, wire receives `z.input`)
- `toConvexJS()` still runs after encoding

## Use Case

Security library where sensitive fields use codecs:
- Runtime: `SensitiveField<T>` class with access control methods
- Wire: `{ value: T, status: 'full' | 'masked' | 'hidden' }` plain object

The codec approach is cleaner than custom Zod types, and this fix enables proper output encoding.

## References

- [Zod Codecs Documentation](https://zod.dev/codecs)
- [Introducing Zod Codecs](https://colinhacks.com/essays/introducing-zod-codecs)
