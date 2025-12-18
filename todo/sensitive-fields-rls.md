# Sensitive Fields & RLS Support for zodvex

> **Status**: Planning / Discovery
> **Date**: 2024-12-18
> **Context**: Consulting engagement exploring Zod + Convex sensitive data handling

---

## Background

A client has built a custom system for handling sensitive fields in Convex using:
- `VSensitive<Inner>` - A wrapper class for Convex validators marking fields as sensitive
- `SensitiveField<T>` - A runtime wrapper holding value + status (authorized/redacted/masked)
- `walkVSensitive()` - Tree walker for transforming sensitive fields
- `hotpotQuery` - Custom query wrapper integrating authorization, RLS, and audit logging

Their system works at the **Convex validator level**. zodvex could provide equivalent functionality at the **Zod schema level**, offering a single source of truth for both validation and sensitivity semantics.

---

## Their Current Architecture

```
Wire Args (SensitiveFieldRaw)
     │
     ▼
walkVSensitive → SensitiveField.deserialize()
     │
     ▼
assertEntitlements(ctx.scope, required)  ← Authorization gate
     │
     ▼
wrapDatabaseReader(ctx)  ← RLS injection
     │
     ▼
handler(ctx, args)  ← Business logic with SensitiveField instances
     │
     ▼
walkVSensitive → .limit(clearance).serialize()
     │
     ▼
Safety check: detect untagged SensitiveField leaks
     │
     ▼
logFieldAccess(ctx, sensitive)  ← Audit trail
     │
     ▼
Wire Response (SensitiveFieldRaw)
```

### Key Components in Their System

1. **VSensitive class** - Wraps Convex validators with `isSensitive` marker
2. **vs.sensitive()** / **vs.optional()** - Factory functions for sensitive validators
3. **transformSensitive()** - Recursively transform validator trees
4. **stripSensitive()** - Remove sensitive wrappers from validators
5. **walkVSensitive()** - Walk data and transform sensitive fields via callback
6. **SensitiveField** - Runtime class with `.serialize()`, `.deserialize()`, `.limit()`
7. **SensitiveFieldRaw** - Wire format: `{ __sensitiveField, status, value, reason }`

---

## Proposed zodvex Additions

### 1. Zod-Native Sensitivity Marking

```typescript
// zodvex/sensitive/marker.ts
import { z } from 'zod'

const SENSITIVE_KEY = Symbol('zodvex.sensitive')

export function zSensitive<T extends z.ZodTypeAny>(schema: T): T & { [SENSITIVE_KEY]: true } {
  // Attach metadata to schema without modifying Zod internals
  const marked = schema as T & { [SENSITIVE_KEY]: true }
  ;(marked as any)[SENSITIVE_KEY] = true
  return marked
}

export function isSensitive(schema: z.ZodTypeAny): boolean {
  return (schema as any)[SENSITIVE_KEY] === true
}

// Usage:
const userSchema = z.object({
  name: z.string(),
  email: zSensitive(z.string()),
  ssn: zSensitive(z.string()),
})
```

### 2. SensitiveField Class

```typescript
// zodvex/sensitive/field.ts
export type SensitiveFieldStatus = 'authorized' | 'redacted' | 'masked' | 'partial'

export interface SensitiveFieldRaw<T = unknown> {
  __sensitiveField: string | null  // 'v1' if authorized, null if redacted
  status: SensitiveFieldStatus
  value: T | null
  reason?: string
}

export class SensitiveField<T> {
  readonly value: T | null
  readonly status: SensitiveFieldStatus
  readonly reason?: string

  private constructor(value: T | null, status: SensitiveFieldStatus, reason?: string) {
    this.value = value
    this.status = status
    this.reason = reason
  }

  // Factory methods
  static authorized<T>(value: T): SensitiveField<T>
  static redacted<T>(reason?: string): SensitiveField<T>
  static masked<T>(maskedValue: T, reason?: string): SensitiveField<T>

  // Status checks
  get isRedacted(): boolean
  get isAuthorized(): boolean

  // Authorization limiting
  limit(clearance: number, requiredClearance: number): SensitiveField<T>

  // Wire format
  serialize(): SensitiveFieldRaw<T>
  static deserialize<T>(raw: SensitiveFieldRaw<T>): SensitiveField<T>
}
```

### 3. Schema Walker for Sensitivity

```typescript
// zodvex/sensitive/walker.ts
export function walkSensitive<T, R>(
  data: unknown,
  schema: z.ZodType<T>,
  callback: (value: unknown, path: string) => R
): unknown {
  // Recursively walk schema, applying callback at sensitive fields
  // Similar structure to their walkVSensitive but working with Zod schemas
}

export function transformSensitiveSchema(
  schema: z.ZodTypeAny,
  replacer: (schema: z.ZodTypeAny) => z.ZodTypeAny
): z.ZodTypeAny {
  // Transform schema tree, replacing sensitive fields
}
```

### 4. Sensitive Codec

```typescript
// zodvex/sensitive/codec.ts
export type SensitiveCodec<T> = {
  validator: GenericValidator           // Base Convex validator
  rawValidator: GenericValidator        // With SensitiveFieldRaw envelope

  decodeArgs: (raw: unknown) => T       // Wire → SensitiveField instances
  encodeReturns: (                      // SensitiveField → wire format
    value: T,
    limiter?: (field: SensitiveField<any>, path: string) => SensitiveField<any>
  ) => unknown

  validateNoLeaks: (value: unknown) => void  // Detect untagged sensitive fields
}

export function sensitiveCodec<T>(schema: z.ZodType<T>): SensitiveCodec<T>
```

### 5. Sensitive Query/Mutation Wrappers

```typescript
// zodvex/sensitive/wrappers.ts
export type SensitiveQueryOptions<Ctx> = {
  entitlements?: string[]
  clearance?: (ctx: Ctx) => number
  audit?: (ctx: Ctx, fields: SensitiveField<any>[]) => void
}

export function zSensitiveQuery<
  Builder extends (fn: any) => any,
  A extends z.ZodTypeAny,
  R extends z.ZodTypeAny,
>(
  query: Builder,
  args: A,
  returns: R,
  handler: (ctx: any, args: z.infer<A>) => z.infer<R>,
  options?: SensitiveQueryOptions<any>
): RegisteredQuery<...>

export function zSensitiveMutation<...>(...): RegisteredMutation<...>
export function zSensitiveAction<...>(...): RegisteredAction<...>
```

### 6. Frontend Client Library (High Value)

```typescript
// zodvex/client/index.ts (separate entry point or package)

/**
 * Parse Convex response, converting SensitiveFieldRaw → SensitiveField
 */
export function parseSensitive<T>(
  data: unknown,
  schema: z.ZodType<T>
): T

/**
 * React hook for ergonomic sensitive field access
 */
export function useSensitiveField<T>(field: SensitiveField<T> | undefined): {
  isRedacted: boolean
  isAuthorized: boolean
  value: T | null
  reason?: string
  render: (
    authorized: (v: T) => ReactNode,
    redacted?: (reason?: string) => ReactNode
  ) => ReactNode
}

/**
 * Type helper to extract unwrapped type
 */
export type Unwrapped<T> = T extends SensitiveField<infer V> ? V : T
```

**Frontend Usage Example:**

```tsx
import { useQuery } from 'convex/react'
import { parseSensitive, useSensitiveField } from 'zodvex/client'
import { userSchema } from '../shared/schemas'
import { api } from '../convex/_generated/api'

function UserProfile({ userId }) {
  const rawUser = useQuery(api.users.get, { id: userId })
  const user = rawUser ? parseSensitive(rawUser, userSchema) : null

  const email = useSensitiveField(user?.email)
  const ssn = useSensitiveField(user?.ssn)

  return (
    <div>
      <h1>{user?.name}</h1>

      {email.render(
        (value) => <a href={`mailto:${value}`}>{value}</a>,
        (reason) => <span className="redacted">Email hidden: {reason}</span>
      )}

      {ssn.isAuthorized ? (
        <span>{ssn.value}</span>
      ) : (
        <button onClick={requestSSNAccess}>Request SSN Access</button>
      )}
    </div>
  )
}
```

---

## Value Proposition

| Capability | Their Current System | zodvex Could Provide |
|------------|---------------------|---------------------|
| Schema source | Convex validators | Zod schemas (single source of truth) |
| Sensitivity marking | `vs.sensitive()` | `zSensitive()` (Zod-native) |
| Type inference | Custom types | Automatic from Zod |
| Backend codec | `walkVSensitive` | `sensitiveCodec` with full pipeline |
| Function wrappers | `hotpotQuery` (custom) | `zSensitiveQuery` (standardized) |
| Frontend parsing | **None** | `parseSensitive()` |
| React integration | **None** | `useSensitiveField()` hook |
| Leak detection | Manual in handler | Built into codec |

### Key Benefits

1. **Single Schema Definition** - Write Zod once, get validation AND sensitivity
2. **Frontend First-Class Support** - Client-side parsing and React hooks
3. **Type Safety Through Stack** - `SensitiveField<string>` vs `SensitiveField<number>` enforced at compile time
4. **Reduced Boilerplate** - `zSensitiveQuery` vs 60+ lines of custom wiring
5. **Portability** - Zod schemas more portable than Convex validators

---

## Implementation Phases

### Phase 1: Frontend Utilities (Low Risk, High Value)
- [ ] `SensitiveField` class with serialize/deserialize
- [ ] `parseSensitive()` function
- [ ] `useSensitiveField()` React hook
- [ ] Type definitions for `SensitiveFieldRaw`

### Phase 2: Zod Sensitivity Marking
- [ ] `zSensitive()` wrapper function
- [ ] `isSensitive()` detection helper
- [ ] Integration with `zodToConvex` to recognize marked schemas

### Phase 3: Schema Walker
- [ ] `walkSensitive()` for data transformation
- [ ] `transformSensitiveSchema()` for schema transformation
- [ ] Proper handling of objects, arrays, unions, records

### Phase 4: Sensitive Codec
- [ ] `sensitiveCodec()` factory
- [ ] `decodeArgs` / `encodeReturns` methods
- [ ] `validateNoLeaks` safety check

### Phase 5: Function Wrappers
- [ ] `zSensitiveQuery`
- [ ] `zSensitiveMutation`
- [ ] `zSensitiveAction`
- [ ] Entitlement/clearance integration points
- [ ] Audit logging hooks

---

## Open Questions for Client

1. **Wire Format** - Is `SensitiveFieldRaw` format finalized or flexible?
2. **Clearance Model** - Numeric clearance levels? Role-based? Path-based?
3. **RLS Integration** - How does `wrapDatabaseReader` work? Do we need to integrate?
4. **Audit Requirements** - What data needs to be logged? Compliance requirements?
5. **Frontend Framework** - React only? Or also Vue/Svelte/etc?
6. **Shared Schemas** - Do they want schemas shared between frontend/backend packages?

---

## Reference: Their hotpotQuery Implementation

```typescript
export const hotpotQuery = <ArgsValidator, ReturnsValidator, ...>(queryDef: {
    args?: ArgsValidator
    returns?: ReturnsValidator
    required?: HotpotEntitlement[]
    handler: (ctx: HotpotQueryCtx, ...args: OneOrZeroArgs) => ReturnValue
}) => {
    const { args, returns, required, handler } = queryDef
    const av = ensureValidator(args)
    const rv = ensureValidator(returns)

    return sessionQuery({
        args: av ? transformSensitive(av, (f) => f.asRawValidator()) : undefined,
        returns: rv ? transformSensitive(rv, (f) => f.asRawValidator()) : undefined,
        handler: async (ctx, rawFnArgs, ...otherArgs) => {
            assertEntitlements(ctx.scope, required)

            const fnArgs = av
                ? walkVSensitive(rawFnArgs, av, (raw) => SensitiveField.deserialize(raw))
                : rawFnArgs

            const pctx = {
                ...ctx,
                db: wrapDatabaseReader(ctx),
            }

            let result = await handler(pctx, fnArgs, ...otherArgs)
            const sensitive = []

            if (rv) {
                result = walkVSensitive(result, rv, (value) => {
                    if (value instanceof SensitiveField) {
                        const limited = value.limit(ctx.session.clearance, 'clearance')
                        sensitive.push(limited)
                        return limited.serialize()
                    }
                    throw new Error(`Expected SensitiveField but found ${value}`)
                })
            }

            // Leak detection
            const untagged = []
            transformObjLeaves(result, (value) => {
                if (value instanceof SensitiveField) untagged.push(value)
            })
            if (untagged.length > 0) {
                throw new AppError('hotpot:sensitive:returns-violation', { untagged: untagged.length })
            }

            logFieldAccess(ctx, sensitive)
            return result
        },
    })
}
```

---

## File Structure (Proposed)

```
src/
├── sensitive/
│   ├── index.ts           # Public exports
│   ├── marker.ts          # zSensitive(), isSensitive()
│   ├── field.ts           # SensitiveField class
│   ├── walker.ts          # walkSensitive(), transformSensitiveSchema()
│   ├── codec.ts           # sensitiveCodec()
│   └── wrappers.ts        # zSensitiveQuery, zSensitiveMutation, zSensitiveAction
│
├── client/
│   ├── index.ts           # Client-side exports
│   ├── parse.ts           # parseSensitive()
│   └── react.ts           # useSensitiveField() hook
```

Package exports:
```json
{
  "exports": {
    ".": "./dist/index.js",
    "./sensitive": "./dist/sensitive/index.js",
    "./client": "./dist/client/index.js"
  }
}
```
