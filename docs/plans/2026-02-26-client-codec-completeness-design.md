# Client Codec Completeness

**Date:** 2026-02-26
**Status:** Design
**Branch:** feat/codec-end-to-end

## Problem

zodvex handles codecs at three client boundaries but misses a fourth:

| Boundary | Codec handler | Status |
|---|---|---|
| React hooks | `createZodvexHooks` | Covered |
| Vanilla client | `ZodvexClient` | Covered |
| Action context | `createZodvexActionCtx` | Covered |
| **Imperative calls on a pre-existing Convex client** | **Nothing** | **Gap** |

The gap surfaces when a consumer needs a `ConvexReactClient` for
`ConvexProviderWithAuth` but also makes imperative calls (`client.query()`,
`client.mutation()`) outside of React hooks. Those calls bypass codecs silently.

A secondary issue: `ZodvexClient` always creates its own `ConvexClient` internally,
forcing consumers who already have a Convex client to maintain two connections.

## Design

Three deliverables, layered:

### 1. `createCodecHelpers(registry)` — the primitive

Extracts the encode/decode logic that's duplicated across all four existing paths
into a single factory exported from `zodvex/core`.

```typescript
// zodvex/core
export function createCodecHelpers(registry: AnyRegistry) {
  function encodeArgs(
    ref: FunctionReference<any, any, any, any>,
    args: any
  ): any {
    const path = getFunctionName(ref)
    const entry = registry[path]
    return entry?.args && args != null
      ? stripUndefined(z.encode(entry.args, args))
      : args
  }

  function decodeResult(
    ref: FunctionReference<any, any, any, any>,
    wireResult: any
  ): any {
    const path = getFunctionName(ref)
    const entry = registry[path]
    if (!entry?.returns) return wireResult
    return entry.returns.parse(wireResult)
  }

  return { encodeArgs, decodeResult }
}
```

All existing paths (`ZodvexClient`, `createZodvexHooks`, `createZodvexActionCtx`)
refactored internally to use this. Consumers who wrap their own clients use it
directly as an escape hatch.

### 2. `ZodvexClient` — accept existing `ConvexClient`

The constructor gains a second shape:

```typescript
type ZodvexClientOptions =
  | { url: string; token?: string | null }   // create internally (current)
  | { client: ConvexClient }                  // wrap existing

class ZodvexClient<R extends AnyRegistry> {
  readonly convex: ConvexClient               // public, for sharing

  constructor(registry: R, options: ZodvexClientOptions) {
    this.registry = registry
    if ('client' in options) {
      this.convex = options.client
    } else {
      this.convex = new ConvexClient(options.url)
      if (options.token) this.convex.setAuth(tokenToFetcher(options.token))
    }
  }
  // query/mutate/subscribe unchanged — use createCodecHelpers internally
}
```

Changes from today:
- `private inner` becomes `readonly convex` (public, for sharing)
- Constructor discriminates on `'client' in options`
- Internal encode/decode delegates to `createCodecHelpers`

### 3. `ZodvexReactClient` — new

Wraps `ConvexReactClient` with codec transforms on all data-carrying methods.
Exported from `zodvex/react` alongside `createZodvexHooks`.

```typescript
type ZodvexReactClientOptions =
  | { url: string }                           // create internally
  | { client: ConvexReactClient }             // wrap existing

class ZodvexReactClient<R extends AnyRegistry> {
  readonly convex: ConvexReactClient          // for ConvexProvider / auth providers
}
```

**Data methods (codec-wrapped):**

| Method | Encode | Decode |
|---|---|---|
| `query()` | args | result |
| `mutation()` | args | result |
| `action()` | args | result |
| `watchQuery()` | args | result (via Watch wrapper) |
| `prewarmQuery()` | args | — |

**Pass-through methods (no codec):**

`setAuth`, `clearAuth`, `close`, `connectionState`,
`subscribeToConnectionState`, `url` getter.

#### `watchQuery` wrapping

Convex's `Watch<T>` has three methods. Only `localQueryResult()` carries data:

```typescript
watchQuery<Q>(ref, ...argsAndOptions): Watch<Q['_returnType']> {
  const wireArgs = this.codec.encodeArgs(ref, args)
  const innerWatch = this.convex.watchQuery(ref, wireArgs, options)

  let lastWire: unknown
  let lastDecoded: unknown

  return {
    onUpdate: (cb) => innerWatch.onUpdate(cb),
    localQueryResult: () => {
      const wire = innerWatch.localQueryResult()
      // Memoize by reference identity to avoid redundant Zod parse
      // when localQueryResult() is called multiple times between
      // server transitions.
      //
      // Convex's client already creates a new object per transition
      // (jsonToConvex in remote_query_set.ts), so this check only
      // deduplicates within a single transition window.
      // See: convex/src/browser/sync/optimistic_updates_impl.ts
      //   TODO(CX-733) — Convex's internal tracker for client-side
      //   result memoization (not yet public).
      if (wire === lastWire) return lastDecoded
      lastWire = wire
      lastDecoded = wire === undefined
        ? undefined
        : this.codec.decodeResult(ref, wire)
      return lastDecoded
    },
    journal: () => innerWatch.journal(),
  }
}
```

#### Provider compatibility

`ConvexProvider` requires the concrete `ConvexReactClient` class.
Auth providers (`ConvexProviderWithAuth`, Clerk, Auth0) are duck-typed —
they only need `{ setAuth, clearAuth }`.

Usage:

```tsx
const zodvex = createZodvexReactClient(registry, { client: convexReactClient })

// Auth providers — zodvex.convex is the inner ConvexReactClient
<ConvexProviderWithAuth client={zodvex.convex} useAuth={useAuth}>
  {/* useZodQuery/useZodMutation handle the React hooks path */}
  {/* zodvex.query()/mutate() handle the imperative path */}
</ConvexProviderWithAuth>
```

### Codegen changes

`_zodvex/client.ts` gains new exports:

```typescript
// Existing
export const { useZodQuery, useZodMutation } = createZodvexHooks(zodvexRegistry)
export const createClient = (opts: ZodvexClientOptions) =>
  createZodvexClient(zodvexRegistry, opts)

// New
export const createReactClient = (opts: ZodvexReactClientOptions) =>
  createZodvexReactClient(zodvexRegistry, opts)
export const { encodeArgs, decodeResult } = createCodecHelpers(zodvexRegistry)
```

### What doesn't change

- `createZodvexHooks` — React hooks path unchanged (refactored internally to
  use `createCodecHelpers`)
- `createZodvexActionCtx` — action context unchanged (same internal refactor)
- Registry type and codegen discovery — unchanged

## Performance

Convex's `ConvexReactClient` does NOT memoize `localQueryResult()` — every
server transition creates a new object via `jsonToConvex()`. The optimization
is server-side (only pushing when query dependencies change).

Our codec layer adds no extra re-renders. The `lastWire`/`lastDecoded`
memoization in `watchQuery` avoids redundant Zod parse when
`localQueryResult()` is called multiple times between transitions.

## Breaking changes

None. All changes are additive:

| Change | Breaking? |
|---|---|
| `createCodecHelpers` | New export |
| `ZodvexClient` accepts `{ client }` | Additive constructor overload |
| `ZodvexClient.convex` (was private `inner`) | New public field |
| `ZodvexReactClient` | New class |
| Codegen: `createReactClient`, `encodeArgs`, `decodeResult` | New exports |

## Consumer impact

A downstream consumer replaces its manual `#encodeArgs`/`#decodeResult` in `ConsumerBaseClient`
with either:
- `ZodvexReactClient` wrapping its existing `ConvexReactClient`, or
- `encodeArgs`/`decodeResult` from the codec utility directly

Both eliminate the duplicated codec dispatch logic.
