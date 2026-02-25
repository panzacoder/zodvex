# Codegen Codec Discovery — Design

## Problem

Codegen loses codec transforms when serializing function args/returns that contain factory-created codecs. The generated registry falls back to the wire schema with `/* codec: transforms lost */`, breaking client-side decode and action-level auto-decode.

### Root cause

`zodToSource` can't serialize `ZodCodec` instances — their `decode`/`encode` functions aren't representable as source code. The current approach references codecs by name via a `codecMap` (identity map from codec instance → exported name). But the `codecMap` is only populated from **top-level module exports**, missing two cases:

1. **Model-embedded codecs** — factory codecs called inline in model definitions (e.g., `tagged(z.string()).optional()` in a field). These are preserved when the schema is identity-matched to a model reference, but lost when a function uses a **derived** schema (`.partial()`, `.extend()`, `.pick()`, `.omit()`).

2. **Orphaned inline codecs** — factory codecs called inline in function args (e.g., `args: { email: tagged(z.string()) }`). Fresh instances with no export and no model backing.

### Reproduction

Added `tagged()` factory codec to the example project. Two breakage points confirmed:

```
'users:getByEmail': {
  args: z.object({ email: z.object({ value: z.string(), tag: z.string() }) /* codec: transforms lost */ }),
}

'users:update': {
  args: z.object({ ..., email: z.object({ value: z.string(), tag: z.string() }) /* codec: transforms lost */.optional().optional(), ... }),
}
```

- `getByEmail`: inline factory codec in args (case 2)
- `update`: `UserModel.schema.doc.partial().extend(...)` — derived model schema (case 1)

### Key insight

Zod v4 preserves codec **object identity** through all derivation methods. Verified:

| Derivation | Identity preserved | Wrapper structure |
|---|---|---|
| `.partial()` | Yes | `Optional(Optional(codec))` |
| `.extend()` | Yes | Same as original |
| `.partial().extend()` | Yes | `Optional(Optional(codec))` |
| `.pick()` / `.omit()` | Yes | Same as original |
| `.partial()` on nullable field | Yes | `Optional(Nullable(codec))` |

This means walking model schemas to extract codec instances and adding them to the `codecMap` enables identity matching for all derived schemas.

## Design

### Model-embedded codec extraction (case 1)

After discovering models, walk each model's schema shapes (`doc.shape`, `insert.shape`, etc.). For each field, unwrap through `ZodOptional`/`ZodNullable` layers. When a `ZodCodec` is found (that isn't `zx.date()`), add the **unwrapped codec instance** to the `codecMap`.

The reference in generated code uses a helper to extract the codec from the model shape at import time:

```ts
// Generated at top of _zodvex/api.ts
import { extractCodec } from 'zodvex/codegen'
import { UserModel } from '../models/user'

const _c0 = extractCodec(UserModel.schema.doc.shape.email)
```

`extractCodec` is a small runtime utility that unwraps `ZodOptional`/`ZodNullable` layers to find the inner `ZodCodec`.

When `zodToSource` processes a derived schema (e.g., `.partial()`) and encounters the codec after peeling wrapper layers, the existing codecMap identity lookup finds `_c0`. The wrapper peeling naturally appends `.optional()` as needed.

### Orphaned inline codecs (case 2)

For codecs in function args/returns that don't match any model-embedded codec or exported singleton, emit a clear warning:

```
[zodvex] Warning: undiscoverable codec in users:getByEmail args.email
  Export the codec instance from a module so codegen can reference it.
  Model fields don't need this — only function args/returns that aren't model references.
```

The generated code still falls back to the wire schema (functional for validation, missing transforms). The warning is actionable — the fix is to export the codec as a singleton:

```ts
// codecs.ts
export const taggedEmail = tagged(z.string())

// users.ts
args: { email: taggedEmail }  // same instance → discoverable
```

### Convention

- **Model fields**: use factory codecs inline freely — they're behind identity refs or extractable
- **Function args/returns**: if using a codec outside a model reference, export it as a named singleton

### Changes by file

**`discover.ts`**
- New: `walkSchemaForCodecs(shape)` — recursively unwrap fields to find `ZodCodec` instances
- After model discovery, walk each model's schema shapes
- Return model-embedded codecs as part of `DiscoveryResult` (separate from exported codecs)

**`generate.ts`**
- Build `codecMap` from BOTH exported codecs AND model-embedded codecs
- For model-embedded codecs, generate `extractCodec(Model.schema.doc.shape.field)` helper vars
- Track needed imports for `extractCodec` and model modules

**`zodToSource.ts`**
- No structural changes — existing wrapper-peeling + codecMap lookup handles everything
- Upgrade the "transforms lost" fallback to record location info for CLI warnings

**`commands.ts`**
- Print warnings for undiscoverable codecs with function path and field info
- Update codec count to include model-embedded codecs

**New: `extractCodec` utility** (in `zodvex/codegen` or `zodvex/core`)
- Unwraps `ZodOptional`/`ZodNullable` to find and return the inner `ZodCodec`
- Used at import time in generated code

## Fallback: Approach C (lazy live-reference registry)

If the export requirement for orphaned codecs proves too restrictive, a future enhancement can switch to live schema references with lazy initialization:

- `_zodvex/api.ts` imports function modules but builds registry lazily (getter function, not top-level const)
- Breaks the circular dep at runtime: function exports are only accessed when the lazy getter is called, not at module init
- Split into `api.ts` (source strings, client-safe) + `api-live.ts` (lazy live refs, server-only) to prevent client bundle from pulling server modules
- `functions.ts` already wraps registry lazily: `registry: () => zodvexRegistry`

This approach is validated but deferred — the model-walking + export convention covers the practical cases.
