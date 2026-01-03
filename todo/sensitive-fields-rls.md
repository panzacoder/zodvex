# Field-Level Security for Zod + Convex

> **Status**: Discovery / Brainstorming
> **Last Updated**: 2025-01-02
> **Context**: Consulting engagement exploring sensitive data handling patterns

This document explores approaches for handling sensitive/protected fields in Convex applications using Zod schemas. It compares the client's current implementation with potential zodvex-based solutions.

---

## Table of Contents

1. [Client's Current System](#clients-current-system)
2. [Core Concepts](#core-concepts)
3. [Representation Models](#representation-models)
4. [The Zod Codec Approach](#the-zod-codec-approach)
5. [Enforcement & Authorization](#enforcement--authorization)
6. [Client-Side Considerations](#client-side-considerations)
7. [Open Questions](#open-questions)
8. [Reference Code](#reference-code)

---

## Client's Current System

The client has built a "Hotpot" system for handling sensitive fields using Convex validators.

### Components

| Component | Purpose |
|-----------|---------|
| `VSensitive<Inner>` | Wrapper class for Convex validators, marks fields as sensitive |
| `vs.sensitive()` | Factory function to create VSensitive instances |
| `SensitiveField<T>` | Runtime class holding value + status (authorized/redacted/masked) |
| `SensitiveFieldRaw` | Wire format: `{ __sensitiveField, status, value, reason }` |
| `walkVSensitive()` | Tree walker for transforming sensitive fields in data |
| `transformSensitive()` | Tree walker for transforming sensitive fields in validators |
| `stripSensitive()` | Removes sensitive wrappers from validators (for table definitions) |
| `hotpotQuery` | Custom query wrapper with authorization, transforms, audit logging |

### Current Data Flow

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

### Pain Points (Per Client)

- Relies on Convex validator internals (e.g., `.json` property)
- Complex TypeScript type gymnastics
- Hard typecasts in several places
- Three different object walk implementations
- Dual schema maintenance (logical schema with `vs.sensitive()`, physical schema after `stripSensitive()`)

### Client's Goals

1. Reduce code maintaining data transforms
2. Remove tight binding to Convex validator internals
3. Leverage Zod v4 codecs and/or zodvex for transform logic
4. Maintain ergonomics: app code only handles `SensitiveField` types

---

## Core Concepts

### Terminology

| Term | Meaning |
|------|---------|
| **RLS (Row-Level Security)** | Can this user see this row at all? |
| **FLS (Field-Level Security)** | Can this user see this field's value? (This system) |
| **Sensitive** | Data classification - field contains PII/protected data |
| **Clearance** | Authorization level determining what user can see |

This system implements **Field-Level Security** - rows are returned, but certain fields may be obscured based on clearance.

### Field States

| Status | `__sensitiveValue` contains | Use case |
|--------|----------------------------|----------|
| `authorized` | Real value | User has clearance |
| `masked` | Masked value (e.g., `a***@example.com`) | Partial visibility |
| `redacted` | `null` | No visibility, with optional reason |

---

## Representation Models

A key architectural decision: how many representations of sensitive data exist?

### Model A: Three Representations (Client's Current Approach)

```
DB:      "alice@example.com"                    (raw value)
Handler: SensitiveField.authorized("...")       (class instance)
Wire:    { __sensitiveValue, status, ... }      (envelope)
```

**How it works:**
- Database stores raw values for efficient indexing
- `stripSensitive(schema)` creates table validator without wrappers
- Transforms happen at every boundary (DB↔Handler, Handler↔Wire)

**Trade-offs:**
- ✅ Indexes use simple paths: `.index('email', ['email'])`
- ✅ DB storage is compact
- ❌ Dual schema maintenance (logical vs physical)
- ❌ More transform logic needed
- ❌ `vs.sensitive()` wrapper complexity

### Model B: Two Representations (Branded Storage)

```
DB + Wire: { __sensitiveValue, status, ... }    (envelope)
Handler:   SensitiveField.authorized("...")     (class instance)
```

**How it works:**
- Database stores the envelope structure directly
- Single codec handles all serialization barriers
- No "strip for DB" step needed

**Trade-offs:**
- ✅ Single codec, simpler transforms
- ✅ No dual schema maintenance
- ✅ DB schema = wire schema = simpler type inference
- ❌ Indexes require nested paths: `.index('email', ['email.__sensitiveValue'])`
- ❌ Slightly more storage overhead

**Client feedback:** Nested index paths are acceptable.

### The 6 Serialization Barriers

Both models must handle transforms at these boundaries:

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
│  ─────────────────── DB ────────────────────────────────            │
└─────────────────────────────────────────────────────────────────────┘
```

With Model B (branded storage), DB and Wire use the same envelope format, so the same codec works everywhere.

---

## The Zod Codec Approach

Zod v4 introduced [codecs](https://zod.dev/codecs) for bidirectional transformations.

### Codec Basics

```typescript
const stringToDate = z.codec(
  z.iso.datetime(),  // input schema
  z.date(),          // output schema
  {
    decode: isoString => new Date(isoString),
    encode: date => date.toISOString(),
  }
)

z.decode(stringToDate, "2024-01-01T00:00:00Z")  // → Date
z.encode(stringToDate, new Date())              // → ISO string
```

Key properties:
- **Bidirectional** - encode and decode are inverses
- **Recursive** - nested codecs in objects auto-apply
- **Type-safe** - `z.decode()` expects typed input

### Client's Prototype

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

This codec:
- Input: Typed envelope with `__sensitiveValue: T`
- Output: `SensitiveField<T>` instance
- Zod's recursive application handles nested sensitive fields

### Schema Definition Would Look Like

```typescript
const patientSchema = z.object({
  id: zid('patients'),
  clinicId: z.string(),
  email: sensitive(z.string()).optional(),
  firstName: sensitive(z.string()).optional(),
  ssn: sensitive(z.string()),
  timezone: z.string().optional(),
})
```

### Questions About Codec Composition

1. **With `.optional()`** - Does `sensitive(z.string()).optional()` work correctly with Zod's codec recursion?

2. **With unions** - Zod docs note unions don't auto-propagate encode/decode. Impact on `z.union([sensitive(z.string()), z.number()])`?

---

## Enforcement & Authorization

Codecs are pure transformations. Authorization is a separate policy layer.

### Enforcement Model Options

**Option: Fail-Secure Defaults**

```typescript
// Standard wrappers → safe defaults
zQuery(query, schemaWithSensitiveFields, handler)
// → Sensitive fields AUTO-REDACTED

zMutation(mutation, schemaWithSensitiveFields, handler)
// → DENIED - must use zSecureMutation

// Secure wrappers → explicit clearance
zSecureQuery(query, schema, handler, { clearance: ... })
// → Evaluates clearance per field

zSecureMutation(mutation, schema, handler, { clearance: ... })
// → Evaluates clearance, allows write
```

**Rationale:**
- Can't accidentally expose data with wrong wrapper
- Queries return data (for non-sensitive fields) but obscure sensitive ones
- Mutations deny entirely - writes need explicit authorization

### Clearance Resolver Signatures

**Option A: Simple Function**

```typescript
type FieldClearance = 'authorized' | 'redacted' | 'masked'

type ClearanceContext<Ctx> = {
  ctx: Ctx
  path: string                  // e.g., "email" or "addresses[0].street"
  fieldSchema: z.ZodTypeAny
}

type ClearanceResolver<Ctx> = (
  context: ClearanceContext<Ctx>
) => FieldClearance | Promise<FieldClearance>

// Usage
zSecureQuery(query, patientSchema, handler, {
  clearance: ({ ctx, path }) => {
    if (ctx.session.role === 'admin') return 'authorized'
    if (path === 'ssn') return 'redacted'
    return 'authorized'
  }
})
```

**Option B: Declarative Config**

```typescript
zSecureQuery(query, patientSchema, handler, {
  clearance: {
    default: 'redacted',
    fields: {
      email: ({ ctx }) => ctx.session.role === 'provider' ? 'authorized' : 'masked',
      ssn: ({ ctx }) => ctx.session.canViewSSN ? 'authorized' : 'redacted',
    }
  }
})
```

**Option C: Schema-Embedded Requirements**

```typescript
const patientSchema = z.object({
  email: sensitive(z.string(), { requiredClearance: 'provider' }),
  ssn: sensitive(z.string(), { requiredClearance: 'admin' }),
})

zSecureQuery(query, patientSchema, handler, {
  clearance: (ctx) => ctx.session.clearanceLevel
})
```

### Authorization Flow

```typescript
// In query wrapper (pseudocode)
const dbResult = await ctx.db.get(id)

// 1. Decode from DB → SensitiveField instances
const decoded = z.decode(schema, dbResult)

// 2. Apply clearance (policy layer)
const authorized = applyClearance(decoded, schema, (field, path) => {
  return clearanceResolver({ ctx, path, fieldSchema: ... })
})

// 3. Encode for wire → envelope
return z.encode(schema, authorized)
```

---

## Client-Side Considerations

### What Client Receives

```typescript
{
  email: { __sensitiveValue: "a***@example.com", status: "masked" },
  ssn: { __sensitiveValue: null, status: "redacted", reason: "requires elevated access" },
  firstName: { __sensitiveValue: "Alice", status: "authorized" }
}
```

### Client Decoding

Client needs to transform envelope → SensitiveField for ergonomic usage:

```typescript
// After useQuery
const rawPatient = useQuery(api.patients.get, { id })
const patient = decode(patientSchema, rawPatient)

// patient.email is now SensitiveField<string>
```

### Rendering Patterns

```tsx
function PatientCard({ patient }) {
  return (
    <div>
      {patient.firstName.isAuthorized && <h1>{patient.firstName.value}</h1>}

      {patient.email.isMasked && (
        <span className="masked">{patient.email.value}</span>
      )}

      {patient.ssn.isRedacted && (
        <span className="redacted">SSN hidden: {patient.ssn.reason}</span>
      )}
    </div>
  )
}
```

### Key Decision: Who Masks?

For `masked` status, does the server send:
- a) The masked value (server applies mask before sending), or
- b) The real value with `status: "masked"` (client applies mask)?

**Recommendation:** Server masks. Client should never receive real value if user shouldn't see it.

---

## Open Questions

### Architecture

1. **Representation model** - Two representations (branded) vs three (raw DB)?
   - Current leaning: Two representations (branded storage)

2. **Codec composition** - How do `sensitive()` codecs compose with `.optional()`, unions, arrays?

### API Design

3. **Write path** - What does client send for mutations?
   - Full envelope?
   - Just raw value (server wraps)?
   - Different input schema for writes?

4. **Masking** - Who defines mask functions?
   - Schema-level: `sensitive(z.string(), { mask: emailMask })`
   - Resolver-level: return `{ status: 'masked', mask: fn }`

5. **Naming** - What to call the secure wrappers?
   - `zSecureQuery` / `zSecureMutation`
   - `zProtectedQuery` / `zProtectedMutation`
   - `zRLSQuery` / `zRLSMutation`

6. **Clearance signature** - Which option (A/B/C) best fits their use cases?

### Integration

7. **zodvex scope** - What should zodvex provide vs what stays in their codebase?
   - Core: `sensitive()` codec, integration with `zodToConvex`
   - Wrappers: `zSecureQuery` etc.
   - Client: decode utilities, React hooks

8. **Audit logging** - How to integrate field access logging?

---

## Reference Code

### Their hotpotQuery Implementation

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

### Their Current Schema Pattern

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
