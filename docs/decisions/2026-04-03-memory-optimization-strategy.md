# Decision: Memory Optimization Strategy for Convex Deployments

**Date:** 2026-04-03 (updated 2026-04-04)
**Status:** S1 complete, S2 complete (internal + codemod), S3/S4 deferred
**Context:** Consumer complaints about Zod overhead in Convex deploys; confirmed via stress testing against real Convex backend.

---

## Problem

Convex loads all modules into a single V8 isolate with a **64MB memory limit** during push. This applies to the module analysis phase (discovering entry points), not just function execution. Zod v4 schema instances dominate memory:

### Standalone Heap Measurements

| Endpoints | Full Zod | zod/mini | Compiled | Savings |
|-----------|----------|----------|----------|---------|
| 50        | 16.8 MB  | 8.7 MB   | 8.7 MB   | 48%     |
| 100       | 32.9 MB  | 16.5 MB  | 16.5 MB  | 50%     |
| 200       | 64.5 MB  | 31.7 MB  | 31.7 MB  | 51%     |
| 250       | 80.1 MB  | 39.3 MB  | 39.3 MB  | 51%     |

### Real Convex Deploy Thresholds

| Variant | OOM Threshold | Headroom vs Baseline |
|---------|---------------|---------------------|
| **Baseline** (full zod) | ~155 endpoints | — |
| **Compiled** (zod + codemod) | ~365 endpoints | **2.4x** |
| **zod-mini** (native mini) | ~365 endpoints | **2.4x** |

Compiled and zod-mini hit the OOM wall at the **exact same threshold**, confirming the codemod produces byte-equivalent memory profiles to hand-written mini. ~25% of the 64MB budget is consumed by Convex runtime overhead.

Reference: [get-convex/convex-backend#414](https://github.com/get-convex/convex-backend/issues/414), [dan-myles/convex-zod4-codegen-oom-repro](https://github.com/dan-myles/convex-zod4-codegen-oom-repro).

## Consumer Paths

### Path 1: Just use zod (default)

No changes needed. zodvex works with full zod out of the box. Suitable for projects with <150 endpoints.

**Example:** `examples/task-manager/`

### Path 2: Just use zod/mini

For projects hitting the memory ceiling, migrate to zod/mini. zodvex provides full mini support via the `zodvex/mini` entrypoint, and `zodvex generate --mini` produces mini-compatible codegen output.

**Migration tool:** The `zod-to-mini` package provides a one-time codemod that converts full-zod code to mini syntax:

```bash
bunx zod-to-mini 'convex/**/*.ts' --transform-imports
```

Run once, commit the result, stay on mini. This is a **one-time migration**, not a build step.

**Example:** `examples/task-manager-mini/`

### Path 3: Compile step (future — not shipping yet)

Write full-zod source, compile to mini transparently at build time. Proven in the stress test (compiled = mini at all scales), but the DX isn't ready:

- Convex doesn't expose a pre-build hook for source compilation
- Shadow directory approach (`convex-mini/`) works but is clunky
- Codegen registry (`_zodvex/api.js`) must run after compilation, adding workflow complexity

**Blocked on:** Convex pre-build hook (to be requested). Once available, the `zod-to-mini` vite plugin could run transparently during `convex deploy`.

**Proof of concept:** The stress test's `compiled` variant demonstrates this works. The `zod-to-mini` vite plugin powers zodvex's own dual test suite (1746 tests passing under both zod and zod/mini from the same source).

## Solutions (Technical Detail)

### S1: Full zod/mini Compatibility (**complete**)

zodvex works identically with both `zod` and `zod/mini`:
- Internal source uses functional forms and `$ZodType` from `zod/v4/core`
- Build-time aliasing via tsup rewrites `'zod'` → `'zod/mini'` in the `zodvex/mini` entrypoint
- Dual test suite validates both variants: 873 tests × 2 = 1746 passing
- `zodvex generate --mini` produces mini-compatible codegen output

### S2: zod-to-mini Codemod + Vite Plugin (**complete**)

**Codemod** (`packages/zod-to-mini/`): AST-based transforms using ts-morph. Type-aware for ambiguous methods (`pick`, `extend`, `partial`, `omit`, `catchall`) using TypeScript's type checker to confirm the receiver is a Zod schema (checks for `_zod` property). 63 unit tests.

Transform categories:
- **Wrappers:** `.optional()` → `z.optional()`, `.nullable()` → `z.nullable()`
- **Checks:** `.email()` → `.check(z.email())`, `.min(n)` → `.check(z.minLength(n))` / `.check(z.gte(n))`
- **Methods:** `.describe(str)` → `.check(z.describe(str))`, `.transform(fn)` → `z.pipe(schema, z.transform(fn))`, `.refine()` → `.check(z.refine())`
- **Top-level:** `.pipe()` → `z.pipe()`, `.brand()` → `z.brand()`, `.default()` → `z._default()`
- **Ambiguous (type-aware):** `.partial()` → `z.partial()`, `.extend()` → `z.extend()`, `.pick()` → `z.pick()`, `.omit()` → `z.omit()`, `.catchall()` → `z.catchall()`
- **Constructor replacements:** `.passthrough()` → `z.looseObject()`, `.strict()` → `z.strictObject()`, `.datetime()` → `z.iso.datetime()`
- **Class refs:** `z.ZodError` → `$ZodError`, `z.ZodObject` → `$ZodObject` (+ core import)
- **Imports:** `'zod'` → `'zod/mini'`

**Vite plugin** (internal): Wraps the codemod for zodvex's dual test suite. Creates a persistent ts-morph Project with tsconfig for type-aware transforms. ~3.4s overhead on the 55-file test suite.

**Shipping as:** One-time migration codemod for path 2 users. The vite plugin stays internal.

### S3: Compile Away Zod Entirely (**deferred**)

Eliminate Zod from the Convex runtime by emitting pre-computed `v.*` validators and compiled codec transforms. Theoretically ~100% memory savings, but:
- Codec transforms are user-authored closures — serialization is undecidable in general
- zod-aot (only existing AOT compiler) punts on transforms/refines
- Not needed while S2 provides 2.4x headroom (365 endpoint ceiling)

### S4: Lazy Zod for Codecs (**deferred**)

Ship `v.*` validators eagerly, lazy-load Zod only for codec encode/decode. Reduces memory proportional to codec density. Interesting but requires rethinking `initZodvex` bootstrap. Park until S2 headroom is insufficient.

## Competitive Landscape

### zod-aot (wakita181009)
- AOT-compiles `.parse()` calls into flat boolean-chain validators
- Does NOT eliminate Zod from runtime (`Object.create(originalSchema)`)
- Targets parse **performance**, not memory
- Not relevant to our memory problem

### libar-dev/zod-convex-packages
- Claims "zero Zod at runtime" — only true for arg/return validators
- Codec system requires Zod at runtime (instanceof checks, safeParse)
- 0 stars, 3 commits, appears AI-generated
- Does NOT do DB-level codec wrapping

### Convex team response
- Ian confirmed the issue ([#414 comment](https://github.com/get-convex/convex-backend/issues/414#issuecomment-4175086650))
- 64MB limit applies to module analysis phase during push
- Exploring options but no immediate fix
- Asked about zod/mini feasibility — our work directly answers this

## Summary

| Path | Who | How | Endpoint Ceiling |
|------|-----|-----|-----------------|
| 1. Just zod | Most users | Default, no changes | ~155 |
| 2. Just zod/mini | Scale-constrained users | One-time codemod migration | ~365 |
| 3. Compile step | Future | Pending Convex pre-build hook | ~365 |

The `zod-to-mini` codemod is the bridge: users who hit the ~155 endpoint wall run it once to migrate to mini, gaining 2.4x headroom. The compile-step concept is proven but not shippable until Convex provides build integration.
