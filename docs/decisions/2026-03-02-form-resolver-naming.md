# Decision: Form Resolver Naming Convention

**Date:** 2026-03-02
**Status:** Accepted
**Context:** zodvex form integration — naming and codegen placement for form library resolvers

---

## Decision

Form resolver exports should be named `{formLibrary}Resolver`, not `zodvexResolver`. Each resolver lives under its own entry point at `zodvex/form/{library}`. The codegen layer (`_zodvex/client.ts`) pre-binds the resolver to the registry.

## Problem

The current export is:

```ts
// zodvex/form/mantine/index.ts
export function zodvexResolver(registry, ref) { ... }
```

`zodvexResolver` claims the zodvex namespace but only works with Mantine. If zodvex adds support for React Hook Form, both resolvers can't be called `zodvexResolver`. The name doesn't scale.

## Solution

### 1. Name resolvers after their target form library

```ts
// zodvex/form/mantine/index.ts
export function mantineResolver(registry, ref) { ... }

// zodvex/form/hookform/index.ts (future)
export function hookformResolver(registry, ref) { ... }
```

The "zodvex" part is already implicit from the import path (`zodvex/form/mantine`). What the consumer cares about is which form library it plugs into.

This follows the broader ecosystem convention where resolvers are named for their target, not their source:
- `@hookform/resolvers/zod` exports `zodResolver` (named for zod, not hook-form)
- `mantine-form-zod-resolver` exports `zodResolver` / `zod4Resolver`

Similarly, zodvex resolvers should be named for their target form library.

### 2. Codegen pre-binds resolvers in `_zodvex/client.ts`

The library function is the **primitive** — it takes `(registry, ref)`:

```ts
// zodvex/form/mantine — library primitive
export function mantineResolver<R extends AnyRegistry>(
  registry: R,
  ref: FunctionReference<any, any, any, any>,
) {
  const path = getFunctionName(ref)
  const entry = registry[path]
  if (!entry?.args) {
    throw new Error(`zodvex: No args schema found for "${path}" in registry`)
  }
  return zod4Resolver(entry.args)
}
```

The codegen layer **curries** it with the app's registry:

```ts
// _zodvex/client.ts (codegen output)
import { mantineResolver as _mantineResolver } from 'zodvex/form/mantine'
import { zodvexRegistry } from './api'

export const mantineResolver = (ref) => _mantineResolver(zodvexRegistry, ref)
```

This matches the existing codegen pattern — `client.ts` already pre-binds `useZodQuery`, `encodeArgs`, `decodeResult` to the registry.

### 3. Consumer API

```tsx
import { mantineResolver } from './_zodvex/client'
import { api } from './_generated/api'

const form = useForm({
  initialValues: { name: '', email: '' },
  validate: mantineResolver(api.patients.create),
})
```

One import, one call. The registry is invisible to the consumer.

## Alternatives Considered

**`zodvexResolver` (current)** — Doesn't scale to multiple form libraries. Two resolvers can't share the same name.

**`zodvexMantineResolver` / `zodvexHookformResolver`** — Verbose and redundant with the import path. `zodvex/form/mantine` → `zodvexMantineResolver` says "zodvex" twice conceptually.

**`formResolver` (generic)** — Too generic. Doesn't tell you which form library it targets if multiple are in scope.

## Migration

Rename `zodvexResolver` → `mantineResolver` in `zodvex/form/mantine/index.ts`. This is a breaking change to an unreleased API (no consumers yet), so no deprecation needed.
