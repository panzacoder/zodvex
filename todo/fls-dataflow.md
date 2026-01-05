# FLS Data Flow: Database → Client

## Visual Overview

```
╔══════════════════════════════════════════════════════════════════════════════════════╗
║                           FLS DATA FLOW: DATABASE → CLIENT                            ║
╠══════════════════════════════════════════════════════════════════════════════════════╣
║                                                                                       ║
║  ┌─────────────────────────────────────────────────────────────────────────────────┐ ║
║  │ 1. DATABASE STORAGE                                                              │ ║
║  │    Type: SensitiveDb<T>                                                          │ ║
║  │    ┌─────────────────────────────────────────────────────────────────────────┐  │ ║
║  │    │ {                                                                       │  │ ║
║  │    │   __sensitiveValue: "john@example.com",  // Raw value, always stored   │  │ ║
║  │    │   __checksum?: "abc123...",              // Optional integrity hash    │  │ ║
║  │    │   __algo?: "hmac-sha256"                 // Algorithm identifier       │  │ ║
║  │    │ }                                                                       │  │ ║
║  │    └─────────────────────────────────────────────────────────────────────────┘  │ ║
║  │    • No status stored - status is computed per-request                          │ ║
║  │    • No reason stored - reason is computed per-request                          │ ║
║  └─────────────────────────────────────────────────────────────────────────────────┘ ║
║                                           │                                           ║
║                                           ▼                                           ║
║                              ┌────────────────────────┐                               ║
║                              │   ctx.db.get(id)       │                               ║
║                              │   (Convex DB read)     │                               ║
║                              └────────────────────────┘                               ║
║                                           │                                           ║
║                                           ▼                                           ║
║  ┌─────────────────────────────────────────────────────────────────────────────────┐ ║
║  │ 2. POLICY APPLICATION (immediately after DB read)                                │ ║
║  │    Functions called:                                                              │ ║
║  │    ┌─────────────────────────────────────────────────────────────────────────┐  │ ║
║  │    │ applyReadPolicy(dbDoc, schema, ctx, resolver, { defaultDenyReason })    │  │ ║
║  │    │   └─► For each sensitive field:                                         │  │ ║
║  │    │       resolveReadPolicy(context, policies, resolver)                    │  │ ║
║  │    │         └─► For each policy tier (full → masked):                       │  │ ║
║  │    │             resolver(context, requirements)                             │  │ ║
║  │    │               └─► Returns: boolean | { ok: boolean, reason?: string }   │  │ ║
║  │    └─────────────────────────────────────────────────────────────────────────┘  │ ║
║  │                                                                                  │ ║
║  │    Reason precedence:                                                            │ ║
║  │    1. Resolver-provided reason (dynamic)  ← e.g. { ok: false, reason: 'step_up' }│ ║
║  │    2. Policy-tier reason (static)         ← e.g. { status: 'masked', reason: X } │ ║
║  │    3. Config defaultDenyReason            ← fallback for hidden status           │ ║
║  └─────────────────────────────────────────────────────────────────────────────────┘ ║
║                                           │                                           ║
║                                           ▼                                           ║
║  ┌─────────────────────────────────────────────────────────────────────────────────┐ ║
║  │ 3. SERVER RUNTIME                                                                │ ║
║  │    Type: SensitiveField<T>                                                       │ ║
║  │    ┌─────────────────────────────────────────────────────────────────────────┐  │ ║
║  │    │ SensitiveField {                                                        │  │ ║
║  │    │   status: 'full' | 'masked' | 'hidden',                                 │  │ ║
║  │    │   field: 'email',                                                       │  │ ║
║  │    │   reason?: 'step_up_required',           // Server-authored code        │  │ ║
║  │    │   [internal value]: T | maskedT | null   // WeakMap storage             │  │ ║
║  │    │ }                                                                       │  │ ║
║  │    └─────────────────────────────────────────────────────────────────────────┘  │ ║
║  │                                                                                  │ ║
║  │    Methods available:                                                            │ ║
║  │    • getValue(): T | null     ← Returns value appropriate to status             │ ║
║  │    • toWire(): SensitiveWire  ← Serializes for transport                        │ ║
║  │    • toString(): '[SensitiveField]'  ← Anti-coercion guard                      │ ║
║  │                                                                                  │ ║
║  │    ⚠️  NO unwrap() method - elevation requires new request with entitlements    │ ║
║  └─────────────────────────────────────────────────────────────────────────────────┘ ║
║                                           │                                           ║
║                                           ▼                                           ║
║                              ┌────────────────────────┐                               ║
║                              │  Handler logic runs    │                               ║
║                              │  (with limited fields) │                               ║
║                              └────────────────────────┘                               ║
║                                           │                                           ║
║                                           ▼                                           ║
║                              ┌────────────────────────┐                               ║
║                              │  field.toWire()        │                               ║
║                              │  (on return)           │                               ║
║                              └────────────────────────┘                               ║
║                                           │                                           ║
║                                           ▼                                           ║
║  ┌─────────────────────────────────────────────────────────────────────────────────┐ ║
║  │ 4. WIRE FORMAT (JSON over HTTP)                                                  │ ║
║  │    Type: SensitiveWire<TStatus, TValue>                                          │ ║
║  │    ┌─────────────────────────────────────────────────────────────────────────┐  │ ║
║  │    │ // status: 'full'                                                       │  │ ║
║  │    │ { __sensitiveField: 'email', status: 'full',                            │  │ ║
║  │    │   value: 'john@example.com' }                                           │  │ ║
║  │    │                                                                         │  │ ║
║  │    │ // status: 'masked'                                                     │  │ ║
║  │    │ { __sensitiveField: 'email', status: 'masked',                          │  │ ║
║  │    │   value: 'jo***@example.com', reason: 'limited_access' }                │  │ ║
║  │    │                                                                         │  │ ║
║  │    │ // status: 'hidden'                                                     │  │ ║
║  │    │ { __sensitiveField: 'email', status: 'hidden',                          │  │ ║
║  │    │   value: null, reason: 'step_up_required' }                             │  │ ║
║  │    └─────────────────────────────────────────────────────────────────────────┘  │ ║
║  │                                                                                  │ ║
║  │    • No integrity metadata (__checksum, __algo) on wire                          │ ║
║  │    • reason is a stable code, not user-facing copy                               │ ║
║  └─────────────────────────────────────────────────────────────────────────────────┘ ║
║                                           │                                           ║
║                                           ▼                                           ║
║                              ┌────────────────────────┐                               ║
║                              │  deserializeWire()     │                               ║
║                              │  (client.ts)           │                               ║
║                              └────────────────────────┘                               ║
║                                           │                                           ║
║                                           ▼                                           ║
║  ┌─────────────────────────────────────────────────────────────────────────────────┐ ║
║  │ 5. CLIENT RUNTIME                                                                │ ║
║  │    Type: SensitiveField<T> (same class, decoded from wire)                       │ ║
║  │    ┌─────────────────────────────────────────────────────────────────────────┐  │ ║
║  │    │ SensitiveField {                                                        │  │ ║
║  │    │   status: 'masked',                                                     │  │ ║
║  │    │   field: 'email',                                                       │  │ ║
║  │    │   reason: 'limited_access',                                             │  │ ║
║  │    │   getValue(): 'jo***@example.com'                                       │  │ ║
║  │    │ }                                                                       │  │ ║
║  │    └─────────────────────────────────────────────────────────────────────────┘  │ ║
║  │                                                                                  │ ║
║  │    Client usage:                                                                 │ ║
║  │    • field.status → check what level of access                                   │ ║
║  │    • field.getValue() → get displayable value (or null if hidden)               │ ║
║  │    • field.reason → map to UI copy (e.g. 'step_up_required' → "Verify identity")│ ║
║  └─────────────────────────────────────────────────────────────────────────────────┘ ║
║                                                                                       ║
╚══════════════════════════════════════════════════════════════════════════════════════╝
```

## Transformation Summary

| Stage | Type | Function | Key Responsibility |
|-------|------|----------|-------------------|
| Database | `SensitiveDb<T>` | (stored) | Raw value + integrity |
| DB → Runtime | → `SensitiveField` | `applyReadPolicy()` | Policy eval + masking (reason computed) |
| | | `resolveReadPolicy()` | |
| | | `resolver()` | |
| Server Runtime | `SensitiveField<T>` | `getValue()` | Status-aware access |
| Runtime → Wire | → `SensitiveWire` | `field.toWire()` | Strip integrity, serialize |
| Wire | `SensitiveWire` | (JSON transport) | Status + value + reason |
| Wire → Client | → `SensitiveField` | `deserializeWire()` | Reconstruct runtime type |
| Client Runtime | `SensitiveField<T>` | `getValue()`, `status` | Safe access + UI hints |

## Type Definitions

### 1. SensitiveDb<T> (Database)

```ts
type SensitiveDb<T> = {
  __sensitiveValue: T      // Raw value, always stored
  __checksum?: string      // Optional integrity hash
  __algo?: string          // Algorithm identifier
}
```

### 2. SensitiveField<T> (Server & Client Runtime)

```ts
class SensitiveField<T, TStatus extends string = string> {
  status: TStatus                    // 'full' | 'masked' | 'hidden'
  field: string | undefined          // Field name for debugging
  reason: ReasonCode | undefined     // Server-authored stable code

  getValue(): T | null               // Status-appropriate value
  toWire(): SensitiveWire            // Serialize for transport
}
```

### 3. SensitiveWire (Wire Format)

```ts
type SensitiveWire<TStatus, TValue> = {
  __sensitiveField?: string | null   // Field name
  status: TStatus                    // 'full' | 'masked' | 'hidden'
  value: TValue | null               // Value appropriate to status
  reason?: ReasonCode                // Stable code for UI hints
}
```

## Reason Code Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         REASON CODE PRECEDENCE                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. RESOLVER (dynamic, per-request)                                          │
│     ┌─────────────────────────────────────────────────────────────────────┐ │
│     │ resolver(context, requirements)                                     │ │
│     │   → { ok: false, reason: 'step_up_required' }                       │ │
│     │                                                                     │ │
│     │ Use case: User needs MFA, session expired, IP not trusted           │ │
│     └─────────────────────────────────────────────────────────────────────┘ │
│                              │                                               │
│                              ▼ (if no resolver reason)                       │
│                                                                              │
│  2. POLICY TIER (static, from schema)                                        │
│     ┌─────────────────────────────────────────────────────────────────────┐ │
│     │ read: [                                                             │ │
│     │   { status: 'full', requirements: '...', reason: 'full_access' },   │ │
│     │   { status: 'masked', requirements: '...', reason: 'partial' }      │ │
│     │ ]                                                                   │ │
│     │                                                                     │ │
│     │ Use case: Explain why masked (e.g. 'compliance_requirement')        │ │
│     └─────────────────────────────────────────────────────────────────────┘ │
│                              │                                               │
│                              ▼ (if no policy reason)                         │
│                                                                              │
│  3. CONFIG DEFAULT (fallback)                                                │
│     ┌─────────────────────────────────────────────────────────────────────┐ │
│     │ { defaultDenyReason: 'access_denied' }                              │ │
│     │                                                                     │ │
│     │ Use case: Generic fallback when no policies matched                 │ │
│     └─────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Key Invariants

1. **Raw value never leaves server** unless status is 'full'
2. **Status computed per-request** - never stored in DB
3. **Reason is server-authored** - clients cannot influence via args
4. **No unwrap()** - elevation requires new request with entitlements
5. **Integrity metadata stripped** from wire format
6. **Policy applied once** - immediately after DB read, not again at serialization
