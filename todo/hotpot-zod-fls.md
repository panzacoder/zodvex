# Hotpot Zod-FLS Migration Plan

## Context

The zodvex security module is a **rewrite of hotpot's security system**, designed to replace it with a Zod-native approach. Per Heath's feedback, the security-specific code should remain internal to hotpot rather than being open-sourced in zodvex.

**Key Insight:** There's a natural separation between:
- **Transformation primitives** - General-purpose schema traversal and value transformation (stays in zodvex)
- **Security layer** - Domain-specific types, policies, and wrappers (migrates to hotpot)

**Strategy:**
1. Draw the line NOW - implement transform primitives as standalone zodvex exports
2. Build security layer on top of transform primitives
3. Migrate only the security layer to `packages/hotpot/src/security/`
4. zodvex keeps useful open-source primitives

---

## Architecture: Two Layers

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  HOTPOT (internal)                                                          │
│  packages/hotpot/src/security/                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│  Security Layer                                                             │
│  • sensitive() marker with security metadata                                │
│  • SensitiveField runtime class                                             │
│  • Policy types and resolution (read/write)                                 │
│  • RLS rules and enforcement                                                │
│  • applyReadPolicy(), validateWritePolicy()                                 │
│  • zSecureQuery, zSecureMutation, zSecureAction                             │
│  • Client utilities (getFieldValue, isFieldHidden, etc.)                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ imports from
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  ZODVEX (open-source)                                                       │
│  src/transform/                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│  Transform Primitives                                                       │
│  • findFieldsWithMeta() - Find schema fields matching a predicate           │
│  • walkSchema() - Visitor pattern for schema introspection                  │
│  • transformBySchema() - Recursive value transformation                     │
│  • transformBySchemaAsync() - Async version for policy resolution           │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ built on
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  ZODVEX (existing)                                                          │
│  src/                                                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│  Core zodvex                                                                │
│  • zodToConvex() mapping                                                    │
│  • zQuery, zMutation, zAction wrappers                                      │
│  • convexCodec                                                              │
│  • zodTable                                                                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Transform Layer (Stays in zodvex)

### Purpose

General-purpose utilities for working with Zod schemas that happen to be useful for security, but have broader applications:

| Primitive | Security Use | Other Use Cases |
|-----------|--------------|-----------------|
| `findFieldsWithMeta()` | Find sensitive fields | Find encrypted fields, computed fields, deprecated fields |
| `walkSchema()` | Traverse for policy metadata | Schema documentation, diffing, migration tools |
| `transformBySchema()` | Apply FLS transforms | Encryption/decryption, logging redaction, serialization |

### File Structure

```
src/transform/
├── index.ts           # Barrel exports
├── traverse.ts        # Schema traversal utilities
├── transform.ts       # Value transformation utilities
└── types.ts           # Shared types
```

### API Design

**File:** `src/transform/types.ts`

```ts
/**
 * Information about a field during schema traversal
 */
export type FieldInfo = {
  path: string
  schema: z.ZodTypeAny
  meta: Record<string, unknown> | undefined
  isOptional: boolean
  parent?: FieldInfo
}

/**
 * Visitor functions for schema walking
 */
export type SchemaVisitor = {
  onField?: (info: FieldInfo) => void | 'skip'  // Return 'skip' to skip children
  onObject?: (info: FieldInfo) => void
  onArray?: (info: FieldInfo) => void
  onUnion?: (info: FieldInfo, variants: z.ZodTypeAny[]) => void
  onOptional?: (info: FieldInfo) => void
}

/**
 * Context passed to transform functions
 */
export type TransformContext<TCtx = unknown> = {
  path: string
  schema: z.ZodTypeAny
  meta: Record<string, unknown> | undefined
  ctx: TCtx
}

/**
 * Transform function signature
 */
export type TransformFn<TCtx = unknown> = (
  value: unknown,
  context: TransformContext<TCtx>
) => unknown

export type AsyncTransformFn<TCtx = unknown> = (
  value: unknown,
  context: TransformContext<TCtx>
) => unknown | Promise<unknown>
```

**File:** `src/transform/traverse.ts`

```ts
import type { FieldInfo, SchemaVisitor } from './types'

/**
 * Walk a Zod schema, calling visitor functions for each node.
 * Handles objects, arrays, optionals, nullables, unions, and discriminated unions.
 *
 * @example
 * ```ts
 * walkSchema(userSchema, {
 *   onField: (info) => {
 *     if (info.meta?.encrypted) {
 *       console.log(`Encrypted field: ${info.path}`)
 *     }
 *   }
 * })
 * ```
 */
export function walkSchema(
  schema: z.ZodTypeAny,
  visitor: SchemaVisitor,
  options?: { path?: string }
): void

/**
 * Find all fields in a schema that match a predicate.
 * Returns field info for each matching field.
 *
 * @example
 * ```ts
 * // Find all fields with 'sensitive' metadata
 * const sensitiveFields = findFieldsWithMeta(
 *   userSchema,
 *   (meta) => meta?.sensitive === true
 * )
 * // => [{ path: 'email', schema: z.string(), meta: { sensitive: true } }, ...]
 * ```
 */
export function findFieldsWithMeta<TMeta>(
  schema: z.ZodTypeAny,
  predicate: (meta: Record<string, unknown> | undefined) => meta is TMeta
): Array<FieldInfo & { meta: TMeta }>

export function findFieldsWithMeta(
  schema: z.ZodTypeAny,
  predicate: (meta: Record<string, unknown> | undefined) => boolean
): FieldInfo[]

/**
 * Get metadata from a Zod schema (wrapper around schema._def.meta)
 */
export function getMetadata(schema: z.ZodTypeAny): Record<string, unknown> | undefined

/**
 * Check if a schema has metadata matching a predicate
 */
export function hasMetadata(
  schema: z.ZodTypeAny,
  predicate: (meta: Record<string, unknown>) => boolean
): boolean
```

**File:** `src/transform/transform.ts`

```ts
import type { TransformFn, AsyncTransformFn, TransformContext } from './types'

/**
 * Recursively transform a value based on its schema structure.
 * Calls the transform function for each field, allowing field-level transformations.
 *
 * @example
 * ```ts
 * // Mask all fields with 'pii' metadata for logging
 * const safeForLogs = transformBySchema(userData, userSchema, null, (value, ctx) => {
 *   if (ctx.meta?.pii) {
 *     return '[REDACTED]'
 *   }
 *   return value
 * })
 * ```
 */
export function transformBySchema<T, TCtx>(
  value: T,
  schema: z.ZodTypeAny,
  ctx: TCtx,
  transform: TransformFn<TCtx>,
  options?: { path?: string }
): T

/**
 * Async version of transformBySchema for transforms that need to await
 * (e.g., policy resolution, encryption with async key lookup)
 *
 * @example
 * ```ts
 * // Apply security policies (async entitlement checks)
 * const limited = await transformBySchemaAsync(doc, schema, ctx, async (value, info) => {
 *   if (isSensitive(info.meta)) {
 *     const decision = await resolvePolicy(info, ctx)
 *     return applyDecision(value, decision)
 *   }
 *   return value
 * })
 * ```
 */
export function transformBySchemaAsync<T, TCtx>(
  value: T,
  schema: z.ZodTypeAny,
  ctx: TCtx,
  transform: AsyncTransformFn<TCtx>,
  options?: { path?: string }
): Promise<T>

/**
 * Options for controlling transform behavior
 */
export type TransformOptions = {
  path?: string

  /**
   * How to handle values that don't match any union variant.
   * - 'passthrough': Return value unchanged (default for non-security)
   * - 'error': Throw an error
   * - 'redact': Replace with null (fail-closed for security)
   */
  unmatchedUnion?: 'passthrough' | 'error' | 'redact'
}
```

**File:** `src/transform/index.ts`

```ts
// Types
export type {
  FieldInfo,
  SchemaVisitor,
  TransformContext,
  TransformFn,
  AsyncTransformFn,
  TransformOptions
} from './types'

// Traversal
export {
  walkSchema,
  findFieldsWithMeta,
  getMetadata,
  hasMetadata
} from './traverse'

// Transformation
export {
  transformBySchema,
  transformBySchemaAsync
} from './transform'
```

### Updated zodvex Exports

**File:** `src/index.ts`

```ts
// ... existing exports ...

// Transform utilities
export * from './transform'
```

Or as a subpath:

**File:** `package.json`

```json
{
  "exports": {
    ".": { ... },
    "./transform": {
      "types": "./dist/transform/index.d.ts",
      "import": "./dist/transform/index.js"
    }
  }
}
```

---

## Security Layer (Migrates to hotpot)

### Current State

| File | Status | Purpose |
|------|--------|---------|
| `types.ts` | Done | Security-specific types (SensitiveDb, SensitiveWire, policies) |
| `sensitive.ts` | Done | `sensitive()` marker - **will use transform/traverse** |
| `policy.ts` | Done | Policy resolution |
| `apply-policy.ts` | Done | Policy application - **will use transform/transform** |
| `sensitive-field.ts` | Done | SensitiveField class |
| `wire.ts` | Done | Wire serialization |
| `fail-secure.ts` | Done | Fail-secure defaults |
| `client.ts` | Done | Client utilities |

### What's Missing

| Component | Status | Description |
|-----------|--------|-------------|
| `zSecureQuery` | Not started | Secure query wrapper with FLS + RLS |
| `zSecureMutation` | Not started | Secure mutation wrapper with write policies |
| `zSecureAction` | Not started | Secure action wrapper |
| RLS primitives | Not started | Row-level security predicates |
| Secure DB wrapper | Not started | Database reader/writer with RLS + FLS |

### Refactoring: Security Uses Transform

After implementing transform layer, refactor security to use it:

**Before (current):**
```ts
// src/security/sensitive.ts
export function findSensitiveFields(schema: z.ZodTypeAny): SensitiveFieldInfo[] {
  // Custom traversal logic duplicated here
}
```

**After (uses transform):**
```ts
// src/security/sensitive.ts
import { findFieldsWithMeta } from '../transform'

export function findSensitiveFields(schema: z.ZodTypeAny): SensitiveFieldInfo[] {
  return findFieldsWithMeta(schema, isSensitiveMetadata)
}
```

**Before (current):**
```ts
// src/security/apply-policy.ts
export async function applyReadPolicy(value, schema, ctx, resolver) {
  // Custom recursive transform logic duplicated here
}
```

**After (uses transform):**
```ts
// src/security/apply-policy.ts
import { transformBySchemaAsync } from '../transform'

export async function applyReadPolicy(value, schema, ctx, resolver, options) {
  return transformBySchemaAsync(value, schema, ctx, async (val, info) => {
    const meta = getSensitiveMetadata(info.schema)
    if (!meta) return val

    const decision = await resolveReadPolicy(
      { ctx, path: info.path, meta, doc: options?.doc, operation: 'read' },
      meta.read ?? [],
      resolver,
      options
    )

    return SensitiveField.fromDecision(val, info.path, decision)
  }, { unmatchedUnion: 'redact' })  // Fail-closed for security
}
```

---

## Implementation Plan

### Phase 1: Transform Layer (zodvex)

**Goal:** Implement general-purpose transform primitives that security will build on.

#### 1.1 Create Transform Types

**New file:** `src/transform/types.ts`
- FieldInfo, SchemaVisitor, TransformContext, TransformFn types

#### 1.2 Implement Schema Traversal

**New file:** `src/transform/traverse.ts`
- `walkSchema()` - Visitor pattern
- `findFieldsWithMeta()` - Predicate-based field search
- `getMetadata()`, `hasMetadata()` - Metadata helpers

Handle:
- Objects (ZodObject)
- Arrays (ZodArray)
- Optionals (ZodOptional)
- Nullables (ZodNullable)
- Unions (ZodUnion)
- Discriminated unions (ZodDiscriminatedUnion)
- Defaults (ZodDefault)
- Effects (ZodEffects) - unwrap to inner

#### 1.3 Implement Value Transformation

**New file:** `src/transform/transform.ts`
- `transformBySchema()` - Sync recursive transform
- `transformBySchemaAsync()` - Async recursive transform

Handle same schema types as traversal, plus:
- `unmatchedUnion` option for fail-closed behavior

#### 1.4 Tests

**New file:** `__tests__/transform/traverse.test.ts`
- walkSchema visits all nodes
- findFieldsWithMeta finds matching fields
- Handles nested objects, arrays, optionals, unions

**New file:** `__tests__/transform/transform.test.ts`
- transformBySchema applies transforms correctly
- Async version works with promises
- unmatchedUnion options work correctly

### Phase 2: Refactor Security to Use Transform

**Goal:** Security layer becomes a thin wrapper around transform primitives.

#### 2.1 Update sensitive.ts

- `findSensitiveFields()` uses `findFieldsWithMeta()`
- `isSensitiveSchema()` uses `hasMetadata()`

#### 2.2 Update apply-policy.ts

- `applyReadPolicy()` uses `transformBySchemaAsync()`
- `validateWritePolicy()` uses `transformBySchemaAsync()`

#### 2.3 Verify Tests Still Pass

All existing security tests should pass after refactoring.

### Phase 3: Complete Security Layer

#### 3.1 RLS Primitives

**File:** `src/security/rls.ts`

```ts
export type RlsRule<TCtx, TDoc> = {
  read?: (ctx: TCtx, doc: TDoc) => boolean | Promise<boolean>
  insert?: (ctx: TCtx, doc: TDoc) => boolean | Promise<boolean>
  update?: (ctx: TCtx, oldDoc: TDoc, newDoc: TDoc) => boolean | Promise<boolean>
  delete?: (ctx: TCtx, doc: TDoc) => boolean | Promise<boolean>
}

export type RlsRules<TCtx, TTables extends Record<string, unknown>> = {
  [K in keyof TTables]?: RlsRule<TCtx, TTables[K]>
}

export function checkRlsRead<TCtx, TDoc>(
  ctx: TCtx,
  doc: TDoc,
  rule: RlsRule<TCtx, TDoc> | undefined
): Promise<boolean>

export function checkRlsWrite<TCtx, TDoc>(
  ctx: TCtx,
  doc: TDoc,
  rule: RlsRule<TCtx, TDoc> | undefined,
  operation: 'insert' | 'update' | 'delete',
  oldDoc?: TDoc
): Promise<boolean>
```

#### 3.2 Secure Database Wrapper

**File:** `src/security/db.ts`

```ts
export type SecureDbConfig<TCtx, TTables> = {
  rules: RlsRules<TCtx, TTables>
  entitlementResolver: EntitlementResolver<TCtx>
  schemas: Record<keyof TTables, z.ZodTypeAny>
  defaultDenyReason?: ReasonCode
}

export function createSecureReader<TCtx, TTables>(
  db: DatabaseReader,
  ctx: TCtx,
  config: SecureDbConfig<TCtx, TTables>
): SecureDatabaseReader<TTables>

export function createSecureWriter<TCtx, TTables>(
  db: DatabaseWriter,
  ctx: TCtx,
  config: SecureDbConfig<TCtx, TTables>
): SecureDatabaseWriter<TTables>
```

#### 3.3 Secure Wrappers

**File:** `src/security/wrappers.ts`

```ts
export type SecureConfig<TCtx> = {
  resolveContext: (ctx: QueryCtx | MutationCtx | ActionCtx) => TCtx | Promise<TCtx>
  entitlementResolver: EntitlementResolver<TCtx>
  rules?: RlsRules<TCtx, DataModel>
  schemas?: Record<string, z.ZodTypeAny>
  authorize?: (ctx: TCtx, args: unknown) => void | Promise<void>
  audit?: {
    onRead?: (ctx: TCtx, accessed: FieldAccess[]) => void | Promise<void>
    onWrite?: (ctx: TCtx, written: FieldAccess[]) => void | Promise<void>
  }
  onDenied?: (info: DeniedInfo) => Error
  defaultDenyReason?: ReasonCode
}

export function zSecureQuery<TConfig extends SecureConfig<TCtx>, TCtx>(
  config: TConfig
): typeof zQuery

export function zSecureMutation<TConfig extends SecureConfig<TCtx>, TCtx>(
  config: TConfig
): typeof zMutation

export function zSecureAction<TConfig extends SecureConfig<TCtx>, TCtx>(
  config: TConfig
): typeof zAction
```

### Phase 4: Migration to Hotpot

#### 4.1 Copy Security Files Only

Copy from `zodvex/src/security/` to `hotpot/packages/hotpot/src/security/`:

```
packages/hotpot/src/security/
├── index.ts
├── client.ts
├── types.ts
├── sensitive.ts        # Imports from 'zodvex/transform'
├── sensitive-field.ts
├── policy.ts
├── apply-policy.ts     # Imports from 'zodvex/transform'
├── wire.ts
├── fail-secure.ts
├── rls.ts
├── db.ts
└── wrappers.ts
```

#### 4.2 Update Imports

Security files import transform primitives from zodvex:

```ts
// packages/hotpot/src/security/sensitive.ts
import { findFieldsWithMeta, hasMetadata } from 'zodvex/transform'

// packages/hotpot/src/security/apply-policy.ts
import { transformBySchemaAsync } from 'zodvex/transform'
```

#### 4.3 Add zodvex Dependency

**File:** `packages/hotpot/package.json`

```json
{
  "dependencies": {
    "zodvex": "^0.4.0"  // With transform exports
  }
}
```

#### 4.4 Update Package Exports

**File:** `packages/hotpot/package.json`

```json
{
  "exports": {
    ".": { ... },
    "./security": {
      "types": "./dist/security/index.d.ts",
      "import": "./dist/security/index.js"
    },
    "./security/client": {
      "types": "./dist/security/client.d.ts",
      "import": "./dist/security/client.js"
    }
  }
}
```

### Phase 5: Clean Up zodvex

After hotpot migration is complete:

1. Remove `src/security/` from zodvex
2. Remove `./security` and `./security/client` exports
3. Keep `src/transform/` and `./transform` export
4. Update README to document transform utilities

---

## File Changes Summary

### zodvex (Stays)

| Action | File |
|--------|------|
| Create | `src/transform/types.ts` |
| Create | `src/transform/traverse.ts` |
| Create | `src/transform/transform.ts` |
| Create | `src/transform/index.ts` |
| Update | `src/index.ts` or `package.json` (add transform export) |
| Create | `__tests__/transform/traverse.test.ts` |
| Create | `__tests__/transform/transform.test.ts` |

### zodvex (Migrates to hotpot, then removed)

| Action | File |
|--------|------|
| Refactor | `src/security/sensitive.ts` (use transform) |
| Refactor | `src/security/apply-policy.ts` (use transform) |
| Create | `src/security/rls.ts` |
| Create | `src/security/db.ts` |
| Create | `src/security/wrappers.ts` |
| Update | `src/security/index.ts` |

### hotpot

| Action | File |
|--------|------|
| Create | `packages/hotpot/src/security/*` (copy from zodvex) |
| Update | `packages/hotpot/package.json` (add zodvex dep, security exports) |
| Deprecate | `convex/hotpot/validators.ts` |
| Deprecate | `convex/hotpot/queries.ts`, `mutations.ts` |
| Deprecate | `convex/hotpot/db.ts`, `documents.ts` |

---

## Open Questions

1. **Transform export path**: Main export (`import { transformBySchema } from 'zodvex'`) or subpath (`import { transformBySchema } from 'zodvex/transform'`)?

2. **Terminology**: Keep `full/masked/hidden` or align with hotpot? (Pending team discussion)

3. **React hooks**: Should `useSensitiveQuery`/`useSensitiveMutation` also move to security package?

---

## Success Criteria

- [ ] Transform layer implemented with tests
- [ ] Security layer refactored to use transform primitives
- [ ] All existing tests pass after refactoring
- [ ] RLS + secure wrappers implemented
- [ ] Migration to hotpot successful
- [ ] At least one hotpot function migrated as proof of concept
- [ ] zodvex keeps only transform layer (security removed)
