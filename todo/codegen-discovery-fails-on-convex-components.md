# Codegen discovery fails on files that import Convex components

## Problem

`discoverModules()` in `src/codegen/discover.ts` does a bare `await import(absPath)` for every file in the convex directory. Any file that instantiates a Convex component at module scope throws at import time, and the entire file is skipped — all exports in that file become invisible to codegen.

```
[zodvex] Warning: Failed to import convex.config.ts: Component definition does not have the required componentDefinitionPath property. This code only works in Convex runtime.
[zodvex] Warning: Failed to import visits/dropIn.ts: Cannot find module '@doxyme/convex-local-dta' ...
```

This affects any file that does something like:

```ts
import { LocalDTA } from '@doxyme/convex-local-dta'
import { components } from './_generated/api'

const localDTA = new LocalDTA(components.localDTA)  // ← throws in Node.js

export const create = hotpotPublicMutation({ ... })  // ← never discovered
```

The `components` object comes from `_generated/api` and requires the Convex runtime to resolve `componentDefinitionPath`. In Node.js (where codegen runs), accessing it throws.

## Impact

- Functions in affected files get no registry entry, so the client boundary layer can't codec-encode their args/returns
- This will get worse as more Convex components are adopted (DTA, rate limiting, etc.)
- `convex.config.ts` itself is always affected (though it typically has no zodvex exports)

## Root cause

`discover.ts:241-247`:

```ts
let moduleExports: Record<string, unknown>
try {
  moduleExports = await import(absPath)
} catch (err) {
  console.warn(`[zodvex] Warning: Failed to import ${file}:`, (err as Error).message)
  continue  // ← entire file skipped
}
```

The import executes all module-scope code. Component constructors and Convex runtime globals throw outside the Convex runtime.

## Recommended fix: Proxy-stub `_generated/api` during discovery

The failing code always traces back to `_generated/api` — that's where `components` and other runtime-only globals live. zodvex can intercept module resolution during discovery and replace it with a deeply-nested Proxy that absorbs property access and constructor calls:

```ts
const noopHandler: ProxyHandler<any> = {
  get: (_target, _prop) => new Proxy(function () {}, noopHandler),
  apply: () => new Proxy({}, noopHandler),
  construct: () => new Proxy({}, noopHandler),
}

// Register via Node's Module.register() or --loader hook before importing
// Intercept _generated/api → return { components: new Proxy({}, noopHandler) }
```

Module-scope code like `new LocalDTA(components.localDTA)` would receive a harmless Proxy instead of throwing. The zodvex builders still attach `__zodvexMeta` correctly — that's pure JS and doesn't depend on the component being real.

### Why this approach

- **Transparent to consumers** — no code changes needed in hotpot or any other project
- **Targeted** — only stubs `_generated/api` (and optionally `_generated/server` for `components`), not the whole runtime
- **Forward-compatible** — handles any current or future Convex component library automatically via the Proxy
- **Low risk** — discovery only reads metadata from exports, it never invokes handlers, so a stubbed component is fine

### Implementation options

1. **`Module.register()` hook** (Node 20.6+) — register a resolve/load hook before the discovery loop that intercepts `_generated/api` imports. Clean separation, no global pollution.
2. **Pre-populate `require.cache`** — for CJS compat, inject a cached module before `import()`. Simpler but less robust.
3. **`node:vm` sandbox** — run the import in a VM context with stubbed globals. Heavier, but fully isolated.

Option 1 is the cleanest fit.

### Workaround (user-side)

Until this is fixed, consumers can move component instantiation into the handler:

```ts
let _localDTA: LocalDTA
function getLocalDTA() {
  return (_localDTA ??= new LocalDTA(components.localDTA))
}

export const create = hotpotPublicMutation({
  handler: async (ctx, args) => {
    const localDTA = getLocalDTA()
    // ...
  },
})
```

This avoids the module-scope throw. But it's a burden on every consumer and doesn't fix `convex.config.ts`.

## Related

- `todo/runtime-registry-warning-noise.md` — the downstream symptom (runtime warning for undiscovered functions)
