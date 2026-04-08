# Design: Codegen Form Resolver Auto-Detection

**Date:** 2026-03-02
**Context:** zodvex codegen should conditionally emit pre-bound form resolver exports in `_zodvex/client.ts`

---

## Problem

`mantineResolver` depends on `mantine-form-zod-resolver` (an optional peer dep). If codegen always emits the import in `client.ts`, projects without Mantine get a module resolution failure at build time. Tree-shaking and lazy imports don't help — ESM resolution fails before bundling, and dynamic `import()` would make the API async.

## Solution: Auto-Detection at Codegen Time

`generate()` in `commands.ts` detects whether `mantine-form-zod-resolver` is installed in the consumer's project. If present, it passes integration flags to `generateClientFile()`, which conditionally emits the pre-bound resolver.

### Detection

In `commands.ts`, before calling `generateClientFile()`:

```ts
function detectFormIntegrations(projectRoot: string): FormIntegrations {
  return {
    mantine: canResolve('mantine-form-zod-resolver', projectRoot),
  }
}
```

`canResolve` checks if the package resolves from the consumer's project directory (not zodvex's own `node_modules`).

### Generation

`generateClientFile()` accepts an options object:

```ts
interface ClientFileOptions {
  form?: { mantine?: boolean }
}

export function generateClientFile(options: ClientFileOptions = {}): string
```

When `options.form?.mantine` is true, the template appends:

```ts
import { mantineResolver as _mantineResolver } from 'zodvex/form/mantine'
import type { FunctionReference } from 'convex/server'

export const mantineResolver = (ref: FunctionReference<any, any, any, any>) =>
  _mantineResolver(zodvexRegistry, ref)
```

### Consumer API

```tsx
import { mantineResolver } from './_zodvex/client'
import { api } from './_generated/api'

const form = useForm({
  initialValues: { name: '', email: '' },
  validate: mantineResolver(api.patients.create),
})
```

One import, one call, registry invisible. Identical to the existing `useZodQuery`/`encodeArgs` pattern.

## Extensibility

Adding another form library (e.g., React Hook Form) means:

1. Add `hookform` flag to `FormIntegrations`
2. Detect `@hookform/resolvers` in `canResolve`
3. Emit `hookformResolver` pre-binding in the template

No config file needed. If manual overrides are ever wanted, a `zodvex.config.ts` can be layered on top of auto-detection later.

## Files Changed

1. `packages/zodvex/src/codegen/generate.ts` — `generateClientFile()` accepts options, conditionally emits resolver
2. `packages/zodvex/src/cli/commands.ts` — `generate()` detects integrations, passes to `generateClientFile()`
3. `packages/zodvex/__tests__/codegen-generate.test.ts` — test both with/without mantine flag
