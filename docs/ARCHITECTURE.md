# zodvex Architecture

This document describes the key architectural decisions and design patterns in zodvex.

## Table of Contents

- [Codec-First Philosophy](#codec-first-philosophy)
- [The zx Namespace](#the-zx-namespace)
- [Wire vs Runtime Types](#wire-vs-runtime-types)
- [Type System: WireInfer](#type-system-wireinfer)
- [Custom Codec Branding](#custom-codec-branding)
- [zodTable Design](#zodtable-design)

---

## Codec-First Philosophy

zodvex adopts an opinionated "codec-first" stance: if you need wire ↔ runtime transformation, use `zx.codec()`. This ensures type safety and consistency across all Convex data flow edges.

### Why Codecs?

Zod's `z.transform()` and `z.pipe()` are **unidirectional** - they only work for parsing (wire → runtime), not encoding (runtime → wire).

In Convex, data flows through four edges:

| Edge | Direction | Transform Works? | Codec Works? |
|------|-----------|------------------|--------------|
| Function args | wire → runtime | ✅ Yes | ✅ Yes |
| Function returns | runtime → wire | ❌ No | ✅ Yes |
| Database writes | runtime → wire | ❌ No | ✅ Yes |
| Database reads | wire → runtime | ✅ Yes | ✅ Yes |

Using transforms creates **silent inconsistency** - they appear to work for args and reads, but silently fail (or produce wrong data) for returns and writes. Codecs ensure all edges are handled correctly.

### Native Zod Codec Handling

zodvex leverages Zod's native codec system:

- `schema.parse(wire)` → runs `codec.decode` → returns runtime value
- `z.encode(schema, runtime)` → runs `codec.encode` → returns wire value

This eliminates the need for custom transformation layers like the legacy `fromConvexJS`/`toConvexJS` functions.

---

## The zx Namespace

The `zx` namespace provides zodvex-specific validators and codecs. The name signals "zodvex" or "zod + convex" - explicit transformations for Convex compatibility.

```typescript
import { z } from 'zod'
import { zx } from 'zodvex'

const schema = z.object({
  id: zx.id('users'),      // Convex ID
  createdAt: zx.date(),    // Date ↔ timestamp codec
  secret: zx.codec(...)    // Custom codec
})
```

### Available Helpers

| Helper | Wire Format | Runtime Format | Use Case |
|--------|-------------|----------------|----------|
| `zx.id('table')` | `string` | `GenericId<T>` | Convex document IDs |
| `zx.date()` | `number` | `Date` | Timestamps |
| `zx.codec(wire, runtime, transforms)` | Custom | Custom | Custom transformations |

### Why `zx.*` Instead of Extending `z.*`?

- Makes Convex-specific transformations explicit (no "magic")
- Clearly distinct from standard Zod types
- Discoverable via IDE autocomplete on `zx.`
- Avoids polluting Zod's namespace

---

## Wire vs Runtime Types

A key concept in zodvex is the distinction between **wire types** (what's stored/transmitted) and **runtime types** (what your code works with).

```
┌─────────────────────────────────────────────────────────────┐
│                        Convex DB                            │
│                    (Wire Format)                            │
│         { createdAt: 1706832000000, ... }                   │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ schema.parse() / codec.decode
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                     Your Handler                            │
│                   (Runtime Format)                          │
│         { createdAt: Date(...), ... }                       │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ z.encode() / codec.encode
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                     Client Response                         │
│                    (Wire Format)                            │
│         { createdAt: 1706832000000, ... }                   │
└─────────────────────────────────────────────────────────────┘
```

### Example: Date Handling

```typescript
// zx.date() is a codec:
// - Wire format: number (timestamp)
// - Runtime format: Date object

const schema = z.object({
  createdAt: zx.date()
})

// Convex stores: { createdAt: 1706832000000 }
// Handler receives: { createdAt: Date(...) }
// Client receives: { createdAt: 1706832000000 }
```

---

## Type System: WireInfer

The `WireInfer<Z>` type helper recursively extracts wire types from Zod schemas. This is critical for Convex's `GenericDocument` constraint, which requires document types to reflect what's stored in the database.

### The Problem

When codecs are nested inside objects, `z.infer<Z>` produces the runtime type, not the wire type:

```typescript
// z.infer gives runtime type (Date), but Convex needs wire type (number)
type Doc = z.infer<typeof schema>  // { createdAt: Date }
// Convex expects: { createdAt: number }
```

### The Solution

`WireInfer<Z>` recursively walks the schema and extracts wire types for codecs:

```typescript
type WireInfer<Z> =
  | Z extends ZodCodec<infer Wire, any> → z.infer<Wire>  // Use wire schema
  | Z extends ZodObject<Shape> → { [K]: WireInfer<Shape[K]> }  // Recurse
  | Z extends ZodOptional<Inner> → WireInfer<Inner> | undefined
  | ... // Handle other wrappers
  | z.infer<Z>  // Fallback for primitives
```

### Optional Field Handling

A subtle but critical detail: optional fields must use TypeScript's `?:` syntax rather than `| undefined` for Convex's index path typing to work correctly.

```typescript
// ❌ Breaks Convex path extraction
type Doc = { email: { value: string } | undefined }

// ✅ Works with Convex path extraction
type Doc = { email?: { value: string } }
```

`WireInfer` uses a separate `WireInferObject` helper that builds objects with proper `?:` syntax for optional fields.

---

## Custom Codec Branding

When consumers create custom codecs and wrap them in type aliases, TypeScript can lose the codec structure information. The `ZodvexCodec<Wire, Runtime>` branded type solves this.

### The Problem

```typescript
// Consumer wants a clean type alias
type MyCodec = z.ZodType<RuntimeType>

function createCodec(): MyCodec {
  return z.codec(wire, runtime, transforms) as MyCodec
  // ❌ Cast loses ZodCodec structure
}

// zodToConvex can't extract wire schema from MyCodec
zodToConvex(createCodec())  // → v.any() (type lost)
```

### The Solution

```typescript
import { ZodvexCodec, zodvexCodec } from 'zodvex'

// Branded type preserves wire schema
type MyCodec = ZodvexCodec<WireSchema, RuntimeSchema>

function createCodec(): MyCodec {
  return zodvexCodec(wire, runtime, transforms)
  // ✅ Wire schema preserved in type
}

// zodToConvex extracts wire schema correctly
zodToConvex(createCodec())  // → v.object({ ... })
```

### How It Works

`ZodvexCodec` adds a phantom brand property that preserves the wire schema type:

```typescript
declare const ZodvexWireSchema: unique symbol

type ZodvexCodec<Wire, Runtime> = z.ZodCodec<Wire, Runtime> & {
  readonly [ZodvexWireSchema]: Wire  // Phantom brand
}
```

The type system checks for this brand before falling back to structural `z.ZodCodec` detection.

---

## zod/mini Compatibility

zodvex works with both full `zod` and `zod/mini`. This is achieved by using `$ZodType` and its subclasses from `zod/v4/core` for all `instanceof` checks and type constraints, following [Zod's library author guidance](https://zod.dev/library-authors).

### How It Works

`zod/v4/core` exports the base classes (`$ZodType`, `$ZodObject`, etc.) that both `zod` and `zod/mini` extend. By constraining on these base types instead of `z.ZodType`, zodvex accepts schemas from either variant.

The internal module `src/zod-core.ts` acts as the centralized import hub — all `instanceof` checks and `_zod.def.*` property access flows through core types.

### Entrypoints

| Entrypoint | Use when |
|------------|----------|
| `zodvex/core` | Your project uses full `zod` |
| `zodvex/mini` | Your project uses `zod/mini` |
| `zodvex/server` | Works with both (uses core types internally) |

The `zodvex/mini` entrypoint re-exports everything from `zodvex/core` but overrides `zx` with types that return `$ZodType` instead of `z.ZodType`. This means `zx.id('users').optional()` chaining is not available — use `z.optional(zx.id('users'))` instead.

### Schema Construction vs Type Constraints

zodvex *constructs* schemas using full `zod` internally (e.g., `z.object()`, `z.union()`), but *constrains* its public API with `$ZodType` from core. This means:

- zodvex's own schemas are always full-zod objects
- Consumer schemas can be either full-zod or zod-mini
- Both pass the `$ZodType` constraint and work through zodvex's pipeline

---

## defineZodModel (Preferred Model API)

`defineZodModel()` is the primary API for defining Convex table schemas, replacing the older `zodTable()`. It provides full codec support, index/search/vector index chaining, and integrates with `initZodvex()` for automatic DB wrapping.

```typescript
import { z } from 'zod'
import { defineZodModel, zx } from 'zodvex/core'

const users = defineZodModel('users', {
  name: z.string(),
  email: z.string().email(),
  createdAt: zx.date(),
})
  .index('email', ['email'])
  .searchIndex('search_name', { searchField: 'name' })
```

### initZodvex

`initZodvex()` is the one-time project setup that returns pre-configured function builders with codec-wrapped `ctx.db`:

```typescript
import { initZodvex } from 'zodvex/server'
import schema from './schema'
import { server } from './_generated/server'

export const { zq, zm, za, ziq, zim, zia } = initZodvex(schema, server, { wrapDb: true })
```

The `wrapDb: true` option wraps `ctx.db` with `ZodvexDatabaseReader`/`ZodvexDatabaseWriter`, which automatically decode documents on read and encode on write using each table's codec schemas.

---

## Design Principles

1. **Explicit over implicit**: The `zx.*` namespace makes Convex-specific behavior visible
2. **Type safety end-to-end**: Wire types flow correctly through validators and document types
3. **Leverage Zod's codec system**: Use `z.encode()`/`schema.parse()` instead of custom transforms
4. **Fail fast with guidance**: Clear errors when incompatible patterns (like `z.date()`) are used
5. **zod/mini compatible**: All type constraints use `zod/v4/core` base classes so zodvex works with both `zod` and `zod/mini`
