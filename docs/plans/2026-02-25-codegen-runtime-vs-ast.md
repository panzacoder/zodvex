# Codegen Architecture: Runtime Introspection vs AST

**Date:** 2026-02-25
**Status:** Living document — captures decisions, costs, and future options

## The Decision

zodvex codegen needed to solve: given a user's Convex project with Zod schemas, models, codecs, and function definitions — generate a runtime registry (`api.ts`) that maps function paths to their args/returns schemas, correctly referencing codecs by identity.

Two families of approach were considered:

1. **AST-based** — Parse `.ts` source files, analyze the syntax tree, extract schema shapes and codec references as strings
2. **Runtime-based** — Dynamically import compiled modules, inspect live Zod objects, serialize them back to source

We chose runtime. Here's what that decision has meant in practice.

## What We Built

### The Pipeline

```
glob *.ts files
    ↓
await import() each compiled module
    ↓
readMeta() on each export → discover models, functions, codecs
    ↓
walkSchemaRecursive() on model schemas → find embedded codecs + access paths
walkFunctionCodecs() on function schemas → find inline codecs + access paths
    ↓
identityMap (schema === ref) → resolve schemas to model references
codecMap (codec === ref) → resolve codecs to export names or extraction expressions
zodToSource() fallback → serialize ad-hoc schemas to source strings
    ↓
emit api.ts with registry, imports, codec extraction vars
```

Every step after the initial glob operates on **live JavaScript objects**, not source text.

### Zod Internals We Depend On

These are the Zod v4 internal properties and instanceof checks used across the pipeline:

| Internal | Where Used | Purpose |
|----------|-----------|---------|
| `schema._zod.def` | everywhere | Access schema definition (shape, options, element, etc.) |
| `instanceof z.ZodObject` | discover, zodToSource | Detect object schemas, access `.def.shape` |
| `instanceof z.ZodUnion` | discover, zodToSource | Detect unions, access `.def.options[]` |
| `instanceof z.ZodArray` | discover, zodToSource | Detect arrays, access `.def.element` |
| `instanceof z.ZodRecord` | discover, zodToSource | Detect records, access `.def.valueType` |
| `instanceof z.ZodTuple` | discover, zodToSource | Detect tuples, access `.def.items[]` |
| `instanceof z.ZodOptional` | discover, extractCodec, zodToSource | Unwrap optional, access `.def.innerType` |
| `instanceof z.ZodNullable` | discover, extractCodec, zodToSource | Unwrap nullable, access `.def.innerType` |
| `instanceof z.ZodCodec` | discover, extractCodec, zodToSource | Detect codecs, access `.def.in` / `.def.out` |
| `instanceof z.ZodLiteral` | zodToSource | Access `.def.values` (Set) |
| `instanceof z.ZodEnum` | zodToSource | Access `.def.entries` |
| `instanceof z.ZodString` | extractCodec, zodToSource | Detect zx.id() via `.description` |
| `def.type` | mapping.ts | Switch on schema type for validator conversion |

**Total surface area:** ~12 instanceof checks, ~15 distinct `.def.*` property accesses.

### Access Paths

The recursive walker synthesizes JavaScript property access strings that navigate from a schema root to a nested codec:

```typescript
// Simple field
'.shape.email'

// Codec inside a union variant
'.shape.payload._zod.def.options[1].shape.email'

// Codec inside an array
'.shape.tags._zod.def.innerType._zod.def.element'

// Deeply nested
'.shape.payload._zod.def.options[0].shape.details._zod.def.innerType.shape.name'
```

These paths appear in generated code as runtime navigation:

```typescript
const _mc0 = extractCodec(ActivityModel.schema.doc.shape.payload._zod.def.options[1].shape.email)
const _mc1 = extractCodec(ActivityModel.schema.doc.shape.tags._zod.def.innerType._zod.def.element)
const _fc0 = extractCodec(readFnArgs(getByEmail).shape.email)
```

## What Runtime Buys Us

### 1. Codec Identity Matching

The core insight: codecs created by factory functions like `custom()` or `tagged()` are unique object instances. Two calls to `custom(z.string())` produce two different objects. Runtime identity (`===`) is the only reliable way to track "which codec is this?" across a codebase.

An AST approach would see `custom(z.string())` as text and could match it structurally, but couldn't distinguish between two different `custom()` calls with the same arguments that happen to produce different codec behaviors.

### 2. Works With Any Code Pattern

Runtime sees the final resolved objects regardless of how they were constructed:

- Re-exports through barrel files → same object identity preserved
- Computed schemas (`buildSchema(config)`) → result is a normal Zod object
- Conditional schemas → only the branch that executed is visible
- Schemas built across multiple files → all resolve to final objects

AST would need to trace imports, evaluate expressions, and handle dynamic construction — essentially reimplementing a subset of the JS runtime.

### 3. No Parser Dependency

Zero dependency on `ts-morph`, `@babel/parser`, `@swc/core`, or TypeScript's compiler API. The codegen is ~600 lines of straightforward object traversal. An AST approach would add a parser (ts-morph alone is ~8MB) and require maintaining visitor patterns for every Zod schema type.

### 4. Schema Serialization Is Mechanical

`zodToSource()` converts a live Zod schema to its source representation by switching on `instanceof` and reading `.def.*` properties. This is exhaustive and deterministic — every Zod type has a known structure. An AST approach wouldn't need this step (it already has source), but would need the inverse: parsing source into a semantic understanding of what schema it represents.

## What Runtime Has Cost Us

### 1. Recursive Walking Complexity

The most direct cost. Because we inspect live objects, discovering codecs inside nested types (unions, arrays, objects within objects) required building `walkSchemaRecursive()` — a 90-line function that:

- Tracks visited schemas to prevent cycles
- Deduplicates codecs by identity
- Unwraps optional/nullable at intermediate levels
- Synthesizes access path strings during descent
- Handles 6 different Zod container types

An AST approach would simply walk the syntax tree, which parsers are purpose-built for. Walking a Zod object graph is walking an *ad-hoc* tree that wasn't designed for external traversal.

### 2. Access Path Fragility

Generated access paths like `._zod.def.options[1].shape.email` are strings that encode Zod's internal structure. They work today because:

- Zod v4's def structure is stable
- We regenerate on every `zodvex generate` run
- The paths only appear in auto-generated files

But they're inherently fragile:
- A Zod minor version that renames `.def.options` to `.def.members` silently breaks all generated paths
- The paths are opaque to humans reading the generated code
- There's no type safety on the path strings — they're constructed via concatenation

An AST approach would reference schemas by source location or export name, avoiding internal structure entirely.

### 3. Two-Phase Build Requirement

Runtime import requires compiled JavaScript. The workflow is:

```
bun run build → zodvex generate
```

Not `zodvex generate` alone. This means:
- Codegen can't run on source-only projects (no build step configured)
- Build errors prevent codegen entirely (can't partially generate)
- Watch mode must rebuild before regenerating
- CI must build before generating

An AST approach works directly on `.ts` source files — no build step needed.

### 4. Side Effect Execution

`await import()` runs module-level code. If a user's module has side effects (HTTP calls, DB connections, console output), codegen triggers them. We mitigate this with try/catch and console warnings, but it's fundamentally unavoidable with runtime import.

### 5. Metadata Convention

Functions and models must attach `__zodvexMeta` via `attachMeta()`. This is a non-standard convention that:
- Requires zodvex's wrapper functions (`zQuery`, `zodTable`, etc.) to call `attachMeta` internally
- Breaks if a user exports a raw Convex function without going through zodvex wrappers
- Uses a non-enumerable property — invisible in debuggers and `JSON.stringify`

An AST approach could discover function schemas by analyzing the call to `query({ args: z.object({...}), ... })` directly in source.

### 6. zx.date() Special-Casing

`zx.date()` is a codec (ZodCodec with `in=ZodNumber, out=ZodCustom`) that we intentionally skip during codec discovery because it maps directly to `v.number()` in Convex and doesn't need codec extraction. This detection is done by inspecting `.def.in` and `.def.out` types at runtime — a heuristic that could false-positive on a user codec with the same shape.

## What an AST Path Would Look Like

If we decided runtime introspection is too costly to maintain, here's what switching to AST would entail:

### Parser Choice

| Parser | Size | Speed | TS Support | Tradeoff |
|--------|------|-------|------------|----------|
| TypeScript Compiler API | ~40MB (via typescript) | Slow | Full | Already a peer dep, but heavy |
| ts-morph | ~8MB | Moderate | Full | Nice API, but large |
| @swc/core | ~2MB (wasm) | Fast | Full | Rust-based, good for codegen |
| oxc-parser | <1MB | Fastest | Full | Newest, smallest |

**Recommendation if switching:** `@swc/core` or `oxc-parser` — fast, small, and sufficient for our needs (we don't need type resolution, just AST walking).

### What AST Would Replace

| Current Runtime Step | AST Equivalent |
|---------------------|----------------|
| `await import()` | `parse(readFileSync(file))` |
| `readMeta()` | Find `zQuery()`/`zodTable()` call sites in AST |
| `instanceof z.ZodObject` | Match `z.object(...)` call expression |
| `walkSchemaRecursive()` | Walk AST nodes inside schema expressions |
| `extractCodec()` | Find call expressions matching known codec factories |
| `zodToSource()` | **Not needed** — already have source text |
| `identityMap` | Match by AST node reference or source location |
| Access paths | Reference by source position or original expression text |

### What AST Can't Do

1. **True identity matching** — If two files import the same codec, AST sees two different import expressions. Runtime sees one object. AST would need import tracing to detect this.

2. **Computed schemas** — `buildSchema(config)` is opaque to AST. Runtime sees the result. AST would need to evaluate the function or give up.

3. **Re-export chains** — `export { Foo } from './bar'` where `./bar` re-exports from `./baz`. AST needs to follow the chain. Runtime resolves it automatically.

### What AST Would Simplify

1. **No access paths** — Instead of `._zod.def.options[1].shape.email`, the generated code would reference the original source expression directly: `UserInvitedPayload.shape.email` or even inline the codec factory call.

2. **No build step** — Parse source directly. `zodvex generate` works standalone.

3. **No side effects** — Parsing doesn't execute code.

4. **No metadata convention** — Discover schemas by recognizing `zQuery({ args: ... })` patterns in source.

5. **Zod version independence** — AST patterns (`z.object(...)`, `z.union(...)`) are user-facing API, not internal structure. These are stable across major versions.

### Estimated Effort to Switch

| Component | Effort | Notes |
|-----------|--------|-------|
| Parser integration | Small | Add dep, parse files |
| Schema pattern matching | Medium | Match `z.object()`, `z.union()`, etc. in AST |
| Codec discovery | Medium | Find codec factory calls, trace imports |
| Import resolution | Large | Follow re-exports, barrel files, relative imports |
| zodToSource removal | Negative (simplification) | Just use original source text |
| Identity deduplication | Large | Implement import tracing for re-export detection |
| Test rewrite | Large | All codegen tests assume runtime objects |

**Total estimate:** Significant rewrite. The import resolution and identity deduplication are the hard parts — they essentially reimplement what the JS module system does for free at runtime.

## Hybrid Approaches

A middle ground might combine both:

### Option A: AST for Discovery, Runtime for Identity

Use AST to find `zQuery()` and `zodTable()` call sites (eliminating `__zodvexMeta`), but still import modules at runtime for codec identity matching. Reduces the metadata convention cost without losing identity matching.

### Option B: Runtime with Source Maps

Keep the runtime approach but use source maps to generate human-readable references instead of internal access paths. Instead of `._zod.def.options[1].shape.email`, emit a comment with the original source location.

### Option C: Schema Fingerprinting

Instead of object identity, compute a structural hash of each codec's encode/decode schema pair. This would allow AST-discovered codecs to match without runtime import. Tradeoff: two structurally identical but semantically different codecs would collide.

## Current Assessment

The runtime approach has been adequate for our needs. The main pain points are:

1. **Generated code reads like generated code** — This is the biggest practical cost. A developer reading `api.ts` sees:
   ```typescript
   const _mc0 = extractCodec(ActivityModel.schema.doc.shape.payload._zod.def.options[1].shape.email)
   const _mc1 = extractCodec(ActivityModel.schema.doc.shape.tags._zod.def.innerType._zod.def.element)
   const _fc0 = extractCodec(readFnArgs(getByEmail).shape.email)

   'activities:update': {
     args: z.object({ payload: z.union([..., z.object({ email: _mc0 })]).optional(), tags: z.array(_mc1).optional() }),
   }
   ```
   The `_mc0`, `_fc0` variable names and the `._zod.def.options[1]` navigation paths make it difficult to trace what codec is being used and where it came from. Compare to what AST-generated code could look like:
   ```typescript
   import { tagged } from '../codecs'

   'activities:update': {
     args: z.object({ payload: z.union([..., z.object({ email: tagged(z.string()) })]).optional() }),
   }
   ```
   The AST version preserves the original author's intent — you can read it and immediately understand "this field uses the `tagged` codec on a string." The runtime version requires you to follow `_mc0` back to its extraction expression, then mentally parse the access path to understand which model field it came from.

   This matters most when debugging codec issues: if a field decodes incorrectly, the developer's first stop is `api.ts` to see what codec is applied. Opaque variable names and internal access paths add friction to that investigation.

2. **Access path fragility** — The `._zod.def.options[1].shape.email` pattern depends on Zod v4 internal structure remaining stable. It works but is brittle.
3. **Two-phase build** — Minor annoyance, not a blocker.
4. **Recursive walking** — Was complex to build but is stable and well-tested (16 dedicated tests).

The costs haven't been severe enough to justify a rewrite. The trigger to reconsider would be:
- A Zod major version that changes internal structure
- A need to support projects that don't use zodvex wrapper functions
- Generated code readability becoming a real debugging bottleneck
- Performance issues with large codebases (many dynamic imports)

Until one of those triggers fires, runtime introspection remains the pragmatic choice.
