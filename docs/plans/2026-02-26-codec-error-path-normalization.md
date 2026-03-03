# Codec Error Path Normalization & Form Integration

**Date:** 2026-02-26
**Status:** Draft
**Branch:** TBD (new branch off main)

## Problem

When zodvex runs `z.encode()` on the client side (arg encoding before network calls),
ZodErrors propagate with paths that reflect the **wire schema structure**, not the
runtime schema the consumer authored.

Example: a consumer's `CustomField` has wire format `{ value: string, status: string }`.
A validation error on the email field produces path `["email", "value"]` instead of
`["email"]`. A form author shouldn't need to know about wire internals.

This affects every `z.encode()` call site where a codec transforms between runtime and
wire representations.

## Current State

### z.encode() Call Sites (12 total)

**Client-side (no error handling, errors bubble to consumer):**
| Location | Registry? | Function Path? |
|----------|-----------|----------------|
| `zodvexClient.ts:32` — `encodeArgs()` | Yes | Yes (`getFunctionName`) |
| `hooks.ts:96` — `useZodMutation()` | Yes | Yes (`getFunctionName`) |
| `actionCtx.ts:29` — `runQuery` wrapper | Yes | Yes (`getFunctionName`) |
| `actionCtx.ts:39` — `runMutation` wrapper | Yes | Yes (`getFunctionName`) |

**Codec utilities (generic, no path context):**
| Location | Schema? | Notes |
|----------|---------|-------|
| `codec.ts:26` — `convexCodec().encode` | Yes (param) | Wrapper API |
| `codec.ts:55` — `encodeDoc()` | Yes (param) | DB write encoding |
| `codec.ts:69,72` — `encodePartialDoc()` | Yes (param) | DB patch encoding |

**Server-side (already has error handling via `handleZodValidationError`):**
| Location | Notes |
|----------|-------|
| `utils.ts:69` — `validateReturns()` | Only call site with try/catch |
| `wrappers.ts:117,194,271` — zQuery/zMutation/zAction | Delegates to validateReturns |

### Example App Form State

- **UI library:** Mantine (`@mantine/core` v8.3.13)
- **Form library:** None — plain React `useState` + native `<form>`
- **`@mantine/form`:** Not installed (Mantine's form package has Zod integration)
- **PatientForm.tsx:56-60:** `handleSubmit` calls `onSubmit(doc)` with no try/catch;
  `error` state exists (line 48) but is never set

---

## Part 1: Automatic Path Normalization at Encode Boundaries

### Goal

Consumers never see codec-internal path segments in ZodErrors. Normalization happens
inside zodvex before the error leaves our code.

### Design

#### `normalizeCodecPaths(error: ZodError, schema: ZodTypeAny): ZodError`

Internal utility (not exported initially). Walks the schema tree alongside each issue's
path to detect codec boundaries:

```typescript
function normalizeCodecPaths(error: z.ZodError, schema: z.ZodTypeAny): z.ZodError {
  const normalized = error.issues.map(issue => {
    const truncatedPath = truncateAtCodecBoundary(issue.path, schema)
    return { ...issue, path: truncatedPath }
  })
  return new z.ZodError(normalized)
}
```

#### `truncateAtCodecBoundary(path: (string | number)[], schema: ZodTypeAny)`

Walks the schema shape following the path segments. When it hits a `ZodCodec` node
(detected via `schema._zod.def.type === 'codec'` or the `ZodvexCodec` brand), it
truncates the path at that point — any deeper segments are wire-internal.

```typescript
function truncateAtCodecBoundary(
  path: (string | number)[],
  schema: z.ZodTypeAny
): (string | number)[] {
  const result: (string | number)[] = []
  let current: z.ZodTypeAny = schema

  for (const segment of path) {
    // Unwrap optional/nullable wrappers
    current = unwrapOuter(current)

    // If current node is a codec, stop — everything after is wire-internal
    if (isCodecSchema(current)) {
      result.push(segment) // include the field name itself
      break
    }

    result.push(segment)

    // Descend into the schema tree
    if (current instanceof z.ZodObject && typeof segment === 'string') {
      current = current.shape[segment]
    } else if (current instanceof z.ZodArray && typeof segment === 'number') {
      current = current.element
    }
    // ... handle unions, tuples, records as needed
  }

  return result
}
```

**Key detail:** The field name itself (e.g., `"email"`) is always included. Only the
sub-path within the codec's wire schema (e.g., `"value"`, `"status"`) is stripped.

#### Where to Apply

Wrap `z.encode()` at the **4 client-side call sites** that have both registry access
and no existing error handling:

```typescript
// zodvexClient.ts — encodeArgs()
private encodeArgs(ref: FunctionReference<any, any, any, any>, args: any): any {
  const path = getFunctionName(ref)
  const entry = this.registry[path]
  if (!entry?.args || !args) return args
  try {
    return stripUndefined(z.encode(entry.args, args))
  } catch (e) {
    if (e instanceof z.ZodError) {
      throw normalizeCodecPaths(e, entry.args)
    }
    throw e
  }
}
```

Same pattern for `hooks.ts:96`, `actionCtx.ts:29`, `actionCtx.ts:39`.

**Not applied to:**
- `codec.ts` utilities (`encodeDoc`, `encodePartialDoc`) — these are low-level
  primitives where consumers may want raw wire errors for debugging
- `validateReturns()` — server-side, errors already wrapped in ConvexError; could
  normalize there too but lower priority (server errors are developer-facing)

### Detecting Codec Schemas

Need to reliably identify `ZodCodec` / `ZodvexCodec` nodes in the schema tree.
Options to investigate:

1. `schema._zod.def.type === 'codec'` — Zod v4 internal, may work
2. `schema instanceof z.ZodCodec` — if Zod v4 exports this class
3. Check for the `ZodvexWireSchema` brand symbol from `types.ts`
4. `'encode' in schema._zod.def && 'decode' in schema._zod.def` — duck typing

Will need to verify which approach works reliably with Zod v4's internals.

### Edge Cases

- **Nested codecs** (codec within codec): truncate at the outermost codec boundary
- **Codec inside array**: `["contacts", 0, "email", "value"]` → `["contacts", 0, "email"]`
- **Codec inside union**: need to probe discriminated union to find the right branch
- **Multiple errors on same codec field**: all get the same truncated path, may need
  deduplication (or let the consumer handle it)
- **Non-codec nested objects**: `["address", "street"]` should pass through unchanged

---

## Part 2: Form Library Integration (Follow-on)

### Goal

Provide a resolver that derives validation from the zodvex registry, so consumers
get client-side form validation from the same schemas that drive server validation —
single source of truth, no manual schema imports.

### Package Structure

```
zodvex/form             — shared form utilities (codec-aware error mapping, types)
zodvex/form/mantine     — @mantine/form adapter
zodvex/form/hookform    — react-hook-form adapter
```

Each adapter is a separate entrypoint with its form library as an optional peer dep.
`zodvex/form` itself has no peer deps beyond what zodvex core already requires.

Consumer imports:

```typescript
import { zodvexResolver } from 'zodvex/form/mantine'
import { zodvexResolver } from 'zodvex/form/hookform'
```

Both export the same `zodvexResolver` name — you import from the one matching your
form library. The resolver signature is identical across adapters:

```typescript
function zodvexResolver<F extends FunctionReference<any, any, any, any>>(
  registry: AnyRegistry,
  ref: F
): LibrarySpecificResolverType
```

### Target: Mantine Form (first consumer)

The example app already uses Mantine (`@mantine/core` v8.3.13) with plain React state
and no form library. `@mantine/form` has `zodResolver` support via
`mantine-form-zod-resolver`.

```bash
# the example app would add:
bun add @mantine/form mantine-form-zod-resolver
```

#### `zodvex/form/mantine`

```typescript
import { zodResolver } from 'mantine-form-zod-resolver'

export function zodvexResolver<F extends FunctionReference<any, any, any, any>>(
  registry: AnyRegistry,
  ref: F
) {
  const path = getFunctionName(ref)
  const entry = registry[path]
  if (!entry?.args) {
    throw new Error(`No schema found for ${path}`)
  }
  // Use the RUNTIME schema for validation (user-facing types, not wire)
  // Mantine's zodResolver handles the ZodError → field error mapping
  return zodResolver(entry.args)
}
```

Consumer usage in the example app:

```tsx
import { useForm } from '@mantine/form'
import { zodvexResolver } from 'zodvex/form/mantine'
import { api } from '../_zodvex/api'

function PatientForm() {
  const form = useForm({
    initialValues: emptyPatient(),
    validate: zodvexResolver(registry, api.patients.create),
  })

  return (
    <form onSubmit={form.onSubmit((values) => consumer.patients.create(values))}>
      <TextInput {...form.getInputProps('firstName')} />
      <TextInput {...form.getInputProps('email')} />
      {/* field errors shown automatically by Mantine */}
    </form>
  )
}
```

#### `zodvex/form/hookform`

```typescript
import { zodResolver } from '@hookform/resolvers/zod'

export function zodvexResolver<F extends FunctionReference<any, any, any, any>>(
  registry: AnyRegistry,
  ref: F
) {
  const path = getFunctionName(ref)
  const entry = registry[path]
  if (!entry?.args) {
    throw new Error(`No schema found for ${path}`)
  }
  return zodResolver(entry.args)
}
```

### Open Questions for Part 2

1. **Runtime vs wire validation:** Resolvers should validate against the runtime schema
   (user types) — but `entry.args` in the registry is the full codec schema. Need to
   confirm that Mantine/RHF's zodResolver calls `.parse()` (runtime) not `.encode()`
   (wire). If it calls `.parse()`, paths will be clean without normalization.
2. **CustomField in forms:** A consumer's `CustomTextInput` works with `CustomField`
   instances. The resolver needs to validate against the form-facing type (which includes
   `CustomField`), not the raw string. This might need consumer-level schema adaptation.
3. **Shared utilities in `zodvex/form`:** Likely candidates: codec-aware error type
   narrowing, `isZodvexValidationError()` guard, field error mapping helpers. Keep this
   minimal until real consumer patterns emerge.

---

## Implementation Order

1. **Spike: codec detection** — verify how to reliably identify codec nodes in Zod v4
   schema tree
2. **`normalizeCodecPaths` utility** — implement + unit test with mock codec schemas
3. **Apply to client encode sites** — wrap the 4 call sites with try/catch + normalize
4. **Integration test** — test with a real codec (e.g., `zx.date()` and a nested object
   codec) to verify path truncation
5. **Example app validation** — verify the normalized errors work with PatientForm's
   existing error handling
6. **(Follow-on) `zodvex/form` package** — shared types + Mantine resolver in
   `zodvex/form/mantine`
7. **(Follow-on) Example app adoption** — wire up `@mantine/form` + zodvexResolver
8. **(Follow-on) hookform resolver** — `zodvex/form/hookform` when a consumer needs it
