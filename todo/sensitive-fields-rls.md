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

---

## Brainstorming: Zod v4 Native Codecs Approach

> **Date**: 2024-12-18
> **Context**: Exploring how to leverage Zod v4's built-in codec API rather than building parallel abstractions

### Zod v4 Codec Primer

From [Zod codecs documentation](https://zod.dev/codecs) and [Colin's introduction](https://colinhacks.com/essays/introducing-zod-codecs):

```typescript
const stringToDate = z.codec(
  z.iso.datetime(),  // input schema (what you receive)
  z.date(),          // output schema (what you get after decode)
  {
    decode: isoString => new Date(isoString),
    encode: date => date.toISOString(),
  }
)

// Usage
z.decode(stringToDate, "2024-01-01T00:00:00Z")  // → Date
z.encode(stringToDate, new Date())              // → "2024-01-01T00:00:00Z"
```

Key properties:
- **Bidirectional** - encode and decode are inverses
- **Recursive** - nested codecs in objects are automatically applied
- **Type-safe** - `z.decode()` expects typed input, not `unknown`

### The Three Representations Problem

Sensitive fields have three representations, not two:

```
DB (raw)  ←→  Handler (SensitiveField<T>)  ←→  Wire (SensitiveFieldRaw)
```

- **DB**: Raw value stored in Convex (e.g., `"alice@example.com"`)
- **Handler**: `SensitiveField<string>` instance with authorization state
- **Wire**: `SensitiveFieldRaw` envelope (`{ __sensitiveField, status, value, reason }`)

### Option A: Two Codecs

```typescript
// Codec for DB ↔ Handler
const dbSensitiveString = z.codec(
  z.string(),                         // DB: raw string
  sensitiveFieldSchema(z.string()),   // Handler: SensitiveField<string>
  {
    decode: (raw) => SensitiveField.unevaluated(raw),
    encode: (field) => field.unwrap(),  // Extract raw value for storage
  }
)

// Codec for Wire ↔ Handler
const wireSensitiveString = z.codec(
  sensitiveFieldRawSchema(z.string()),  // Wire: { __sensitiveField, status, value, ... }
  sensitiveFieldSchema(z.string()),     // Handler: SensitiveField<string>
  {
    decode: (raw) => SensitiveField.deserialize(raw),
    encode: (field) => field.serialize(),
  }
)
```

### Option B: One Codec + Strip Function

```typescript
const zSensitive = <T extends z.ZodTypeAny>(inner: T) => {
  // Returns a codec that transforms between SensitiveFieldRaw ↔ SensitiveField<T>
  return z.codec(
    sensitiveFieldRawSchema(inner),
    sensitiveFieldInstanceSchema(inner),
    {
      decode: (raw) => SensitiveField.deserialize(raw),
      encode: (field) => field.serialize(),
    }
  )
}

// Schema uses wire codec (what functions see)
const patientSchema = z.object({
  email: zSensitive(z.string()).optional(),
})

// Table definition strips to raw values
const tableSchema = stripToRaw(patientSchema)  // z.object({ email: z.string().optional() })
```

### Authorization as Separate Layer

Codecs are pure transformations. Authorization (`.limit(clearance)`) is a policy decision that needs runtime context.

Proposed separation:

```typescript
// In query wrapper
const result = await handler(ctx, args)

// 1. Apply authorization (policy layer - needs ctx)
const authorized = applyClearance(result, schema, ctx.session.clearance)

// 2. Encode for wire (pure transformation - no ctx needed)
return z.encode(schema, authorized)
```

This keeps:
- **Codec**: Pure, testable, bidirectional transformation
- **Authorization**: Separate concern with access to session/clearance context

### Current Client Schema Example

For reference, here's how they currently define a table with sensitive fields:

```typescript
import { defineTable } from 'convex/server'
import { v } from 'convex/values'
import { stripSensitive, vs } from '@/convex/hotpot/validators'

export const schema = v.object({
    clinicId: v.string(),
    email: vs.optional(vs.sensitive(v.string())),
    firstName: vs.optional(vs.sensitive(v.string())),
    lastName: vs.optional(vs.sensitive(v.string())),
    phoneNumber: vs.optional(vs.sensitive(v.string())),
    timezone: v.optional(v.string()),
    isIdentified: v.optional(v.boolean()),
})

// Strip sensitive wrappers for actual table definition
export const table = defineTable(stripSensitive(schema))
    .index('clinicId', ['clinicId', 'isIdentified'])
    .index('email', ['email'])
    .index('phoneNumber', ['phoneNumber'])

export const rules = {
    read: async ({ scope }: SessionQueryCtx, patient: SecDoc<'patients'>) => {
        if (scope.role === 'patient') {
            return scope.patientId === patient._id
        }
        if (scope.role === 'provider') {
            return scope.clinicId === patient.clinicId
        }
        return false
    },
}
```

With Zod codecs, equivalent might look like:

```typescript
import { z } from 'zod'
import { zSensitive, stripToRaw } from 'zodvex/sensitive'

export const patientSchema = z.object({
    clinicId: z.string(),
    email: zSensitive(z.string()).optional(),
    firstName: zSensitive(z.string()).optional(),
    lastName: zSensitive(z.string()).optional(),
    phoneNumber: zSensitive(z.string()).optional(),
    timezone: z.string().optional(),
    isIdentified: z.boolean().optional(),
})

// For table definition - strips codecs to raw validators
export const table = defineTable(zodToConvex(stripToRaw(patientSchema)))
    .index('clinicId', ['clinicId', 'isIdentified'])
    .index('email', ['email'])
    .index('phoneNumber', ['phoneNumber'])

// RLS rules remain the same pattern
export const rules = {
    read: async (ctx, patient) => {
        // ... same logic
    },
}
```

### Open Questions

1. **Codec composition with optional** - Does `zSensitive(z.string()).optional()` compose correctly with Zod's codec recursion?

2. **Union handling** - Zod docs note that unions don't automatically propagate encode/decode. How does this affect schemas with sensitive fields inside unions?

3. **DB codec necessity** - Do we need a separate DB codec, or can we just strip the wire codec for table definitions?

4. **Branding idea revisited** - The client mentioned storing branded structures (`{ __sensitiveValue: T }`). Could this simplify the codec by making DB and Wire formats more similar?

---

## Refined Architecture: Two Representations + Branded Storage

> **Date**: 2024-12-31
> **Context**: Further discussion clarified the client's goals and constraints

### Two Representations, Not Three

The branding approach collapses representations:

```
Previous thinking (3 representations):
  DB: "alice@example.com"                          (raw)
  Handler: SensitiveField.authorized("...")        (instance)
  Wire: { __sensitiveValue, status, ... }          (envelope)

Refined model (2 representations):
  DB + Wire: { __sensitiveValue, status, ... }     (envelope)
  Handler: SensitiveField.authorized("...")        (instance)
```

**Benefits:**
- Single codec handles all serialization barriers
- No "strip for DB" complexity
- DB schema matches wire schema
- Type inference is straightforward

**Tradeoff:**
- Indexes must use `field.__sensitiveValue` instead of `field`
- Client confirmed this is acceptable

### The Sensitive Codec (Client Prototype)

```typescript
export const sensitive = <V extends Value, T extends z.ZodType<V>>(validator: T) => {
    return z.codec(
        ZSensitiveFieldRaw.extend({
            __sensitiveValue: z.optional(validator),
        }),
        z.custom<SensitiveField<V>>((val) => val instanceof SensitiveField),
        {
            decode: (raw) => SensitiveField.deserialize(raw),
            encode: (field) => field.serialize(),
        },
    )
}
```

### The 6 Serialization Barriers

All barriers use the same codec, just encode or decode:

```
┌─────────────────────────────────────────────────────────────────────┐
│                           CLIENT                                     │
├─────────────────────────────────────────────────────────────────────┤
│  App Code (SensitiveField)                                          │
│       │                              ▲                              │
│       ▼ encode                       │ decode                       │
│  ─────────────────── Wire (Envelope) ───────────────────            │
└─────────────────────────────────────────────────────────────────────┘
                        │              ▲
                        ▼              │
┌─────────────────────────────────────────────────────────────────────┐
│                           SERVER                                     │
├─────────────────────────────────────────────────────────────────────┤
│  ─────────────────── Wire (Envelope) ───────────────────            │
│       │ decode                       ▲ encode (after clearance)     │
│       ▼                              │                              │
│  Handler Code (SensitiveField)  ──────┘                             │
│       │ encode                       ▲ decode                       │
│       ▼                              │                              │
│  ─────────────────── DB (Envelope) ─────────────────────            │
└─────────────────────────────────────────────────────────────────────┘
```

**Serialize (SensitiveField → Envelope):**
- Server: Before DB insert/update
- Server: Before returning function response (after clearance applied)
- Client: Before function call

**Deserialize (Envelope → SensitiveField):**
- Server: After DB query
- Server: Before calling handler (from wire args)
- Client: After function response

### Naming Discussion

| Term | Meaning |
|------|---------|
| **RLS (Row-Level Security)** | "Can this user see this row at all?" |
| **FLS (Field-Level Security)** | "Can this user see this field's value?" |
| **Sensitive** | Data classification - this field contains PII/protected data |
| **Clearance** | Authorization level - what the user is allowed to see |

This system is really **Field-Level Security** with sensitive data classification. The row is returned, but certain fields may be obscured.

**Naming options for wrappers:**
- `zSecureQuery` / `zSecureMutation` - emphasizes security enforcement
- `zProtectedQuery` / `zProtectedMutation` - emphasizes data protection
- `zRLSQuery` / `zRLSMutation` - uses familiar term (even if technically FLS)

The `sensitive()` codec name is good - it describes the data classification.

### Enforcement Model

```typescript
// Schema with sensitive fields
const patientSchema = z.object({
  id: zid('patients'),
  clinicId: z.string(),
  email: sensitive(z.string()),
  ssn: sensitive(z.string()),
})

// Using standard wrapper → safe defaults (fail secure)
zQuery(query, patientSchema, handler)
// → Sensitive fields AUTO-OBSCURED (redacted)

zMutation(mutation, patientSchema, handler)
// → DENIED - must use zSecureMutation

// Using secure wrapper → clearance evaluated
zSecureQuery(query, patientSchema, handler, { clearance: ... })
// → Evaluates clearance per field

zSecureMutation(mutation, patientSchema, handler, { clearance: ... })
// → Evaluates clearance, allows write
```

**Rationale:**
- Can't accidentally expose sensitive data by using wrong wrapper
- `zQuery` returns data (useful for non-sensitive fields) but obscures sensitive ones
- `zMutation` denies entirely because writes need explicit authorization

### Clearance Function Signature

**Option A: Simple function**

```typescript
type FieldClearance = 'authorized' | 'redacted' | 'masked'

type ClearanceContext<Ctx> = {
  ctx: Ctx                      // Query/mutation context (has session, auth, etc.)
  path: string                  // e.g., "email" or "addresses[0].street"
  fieldSchema: z.ZodTypeAny     // The inner schema of the sensitive field
}

type ClearanceResolver<Ctx> = (
  context: ClearanceContext<Ctx>
) => FieldClearance | Promise<FieldClearance>

// Usage
const getPatient = zSecureQuery(query, patientSchema, handler, {
  clearance: ({ ctx, path }) => {
    if (ctx.session.role === 'admin') return 'authorized'
    if (path === 'ssn' && !ctx.session.canViewSSN) return 'redacted'
    if (path === 'email') return 'masked'
    return 'authorized'
  }
})
```

**Option B: Declarative config**

```typescript
const getPatient = zSecureQuery(query, patientSchema, handler, {
  clearance: {
    default: 'redacted',
    fields: {
      email: ({ ctx }) => ctx.session.role === 'provider' ? 'authorized' : 'masked',
      ssn: ({ ctx }) => ctx.session.canViewSSN ? 'authorized' : 'redacted',
    }
  }
})
```

**Option C: Schema-level clearance requirements**

```typescript
// Clearance requirements embedded in schema
const patientSchema = z.object({
  email: sensitive(z.string(), { requiredClearance: 'provider' }),
  ssn: sensitive(z.string(), { requiredClearance: 'admin' }),
})

// Wrapper just provides current clearance level
const getPatient = zSecureQuery(query, patientSchema, handler, {
  clearance: (ctx) => ctx.session.clearanceLevel  // e.g., 'basic' | 'provider' | 'admin'
})
```

### Client-Side Rendering

Server decides clearance and returns envelope with appropriate status:

```typescript
// Server returns (after clearance evaluation):
{
  email: { __sensitiveValue: "a***@example.com", status: "masked" },
  ssn: { __sensitiveValue: null, status: "redacted", reason: "requires elevated access" },
  firstName: { __sensitiveValue: "Alice", status: "authorized" }
}
```

Client decodes to `SensitiveField` instances and renders based on status:

```tsx
function PatientCard({ patient }) {
  return (
    <div>
      {patient.firstName.render(
        (name) => <h1>{name}</h1>,
        () => <h1>[Name Hidden]</h1>
      )}

      {patient.email.isAuthorized && (
        <a href={`mailto:${patient.email.value}`}>{patient.email.value}</a>
      )}
      {patient.email.isMasked && (
        <span className="masked">{patient.email.value}</span>
      )}
      {patient.email.isRedacted && (
        <span className="redacted">Email hidden: {patient.email.reason}</span>
      )}
    </div>
  )
}
```

**Key decision:** Server masks the value before sending. The `__sensitiveValue` field contains:
- Real value (if `authorized`)
- Masked value (if `masked`) - server applies mask
- `null` (if `redacted`)

Client never receives real value if user shouldn't see it.

### What zodvex Needs to Provide

| Component | Purpose |
|-----------|---------|
| `sensitive(schema)` | Zod codec factory for sensitive fields |
| `zodToConvex` integration | Recognize sensitive codecs, emit branded validators |
| `zSecureQuery` | Query wrapper with clearance evaluation |
| `zSecureMutation` | Mutation wrapper with clearance evaluation |
| `zQuery/zMutation` override | Auto-obscure or deny when sensitive fields present |
| `applyClearance(data, schema, resolver)` | Walk schema, evaluate clearance, transform fields |
| Client `decode` utilities | Transform envelope → SensitiveField after API call |
| Client React hooks | `useSensitiveQuery`, field rendering helpers |

### Open Questions (Updated)

1. **Codec composition with optional** - Does `sensitive(z.string()).optional()` compose correctly?

2. **Union handling** - Unions don't auto-propagate encode/decode. Impact on sensitive fields in unions?

3. **Write path** - What does client send for mutations?
   - Full envelope with `status: "authorized"`?
   - Just raw value, server wraps?
   - Different input schema for writes?

4. **Masking implementation** - Who defines the mask function for `masked` status?
   - Schema-level: `sensitive(z.string(), { mask: emailMask })`
   - Clearance-level: resolver returns `{ status: 'masked', mask: emailMask }`

5. **Naming finalization** - `zSecureQuery` vs `zRLSQuery` vs `zProtectedQuery`?

6. **Clearance signature** - Option A (function) vs B (declarative) vs C (schema-embedded)?
