# Decode Error Handling Design

**Date:** 2026-03-02
**Status:** Approved

## Problem

`decodeResult()` calls `.parse()` on wire data with zero error handling. If the data doesn't match the schema (e.g., invalid email in a SensitiveField codec, stale seed data), a ZodError propagates synchronously into React render and crashes the page.

## Design

### Behavior

`decodeResult()` switches from `.parse()` to `.safeParse()`. On failure:

- **`'warn'` (default):** `console.warn` with function path, Zod issues, and truncated wire data preview. Returns raw `wireResult` untransformed. Page stays alive; types degrade gracefully (e.g., timestamps stay as numbers, SensitiveField stays as wire representation).

- **`'throw'` (opt-in):** Throws a `ZodvexDecodeError` (extends `z.ZodError`) with `functionPath` and `wireData` attached. Extends ZodError to preserve compatibility with existing Zod tooling (`instanceof ZodError` still works).

### Error type

```typescript
class ZodvexDecodeError extends z.ZodError {
  readonly functionPath: string
  readonly wireData: unknown
}
```

Extends `z.ZodError` so that:
- `instanceof ZodError` checks still match
- Sentry, error boundaries, and logging middleware that inspect ZodError work unchanged
- Extra fields (`functionPath`, `wireData`) available for debugging

### Configuration

Option passed at creation time, flows through `createCodecHelpers`:

```typescript
createCodecHelpers(registry, { onDecodeError: 'warn' | 'throw' })

// Consumer APIs:
createZodvexHooks(registry, { onDecodeError: 'throw' })
new ZodvexClient(registry, { url, onDecodeError: 'throw' })
new ZodvexReactClient(registry, { client, onDecodeError: 'throw' })
```

Default is `'warn'` everywhere. No breaking change for existing consumers.

### Scope

**Decode path (changed):** All `decodeResult()` calls — centralized in `codecHelpers.ts`. Affects:
- `useZodQuery`, `useZodMutation` (hooks.ts)
- `ZodvexClient.query/mutate/subscribe` (zodvexClient.ts)
- `ZodvexReactClient.query/mutation/action/watchQuery` (zodvexReactClient.ts)
- `actionCtx` wrappers (actionCtx.ts)

**Encode path (unchanged):** `encodeArgs()` continues to throw on failure. Encoding invalid data is a developer bug, not a data-integrity issue.

### Non-goals

- No React Query-style `{ data, error }` return shape — too different from Convex's `useQuery` contract.
- No per-call configuration — noisy and breaks drop-in replacement semantics.
- No global mutable config — harder to test and reason about.
