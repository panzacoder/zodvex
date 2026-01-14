# Field-Level Security for zodvex

## Overview

Add a two-layer Field-Level Security (FLS) system as a new `zodvex/security` subpath export:

- **Layer 1**: Schema marking + traversal utilities + policy application helpers
- **Layer 2**: Opinionated secure wrappers (`zSecureQuery`/`zSecureMutation`/`zSecureAction`) and a `SensitiveField<T>` runtime type

Primary goals:

- Application code (client + server) works with `SensitiveField<T>`, not raw PII.
- The database always stores the **raw** value (never persisted as redacted/masked).
- The server computes viewer-specific output (status/value/reason) and the client never receives plaintext unless allowed.
- Authorization complexity (entitlements/ABAC) is **100% user-managed**; zodvex supplies plumbing, not policy.

## Prototype Checklist

Before implementing, validate these mechanics with small spikes/tests:

- [x] `sensitive(z.*)` maps to DB shape `v.object({ __sensitiveValue: ... })` (incl. `.optional()`, arrays, nesting, and unions)
- [x] Convex indexing/querying works with branded paths (e.g. `email.__sensitiveValue`) for `defineTable().index()` + `.withIndex()`
- [x] End-to-end: DB raw → server `SensitiveField` → apply policy once (default deny) → wire envelope → client decode
- [x] `z.union()` and `z.discriminatedUnion()` traverse all variants for sensitive fields (tested: nested DUs, optional sensitive in variants, multiple sensitive per variant)
- [x] Fail-closed: unmatched union/DU values are redacted (not passed through) - prevents data leaks from schema/data mismatches
- [x] "Policy before handler" works without a privileged-unwrapping escape hatch (elevation happens via entitlements on a new request)
- [x] Field-level write policies enforced at mutation time (validateWritePolicies, assertWriteAllowed)

## RLS vs FLS: Key Distinction

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      ROW-LEVEL SECURITY (RLS)                               │
├─────────────────────────────────────────────────────────────────────────────┤
│  Question: "Can you access THIS RECORD at all?"                            │
│  Answer: Binary YES or NO                                                   │
│  Based on: Relationships, ownership, organizational membership             │
│  If NO: Record is not returned (filtered out of results)                   │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                     FIELD-LEVEL SECURITY (FLS)                              │
├─────────────────────────────────────────────────────────────────────────────┤
│  Question: "GIVEN you can access this record, what can you see/do          │
│             with each FIELD?"                                               │
│  Answer: Granular per-field                                                 │
│    - Reads: full / masked / hidden (based on entitlements)                 │
│    - Writes: allowed / denied (based on entitlements)                      │
│  Based on: Entitlements, clearance level                                   │
└─────────────────────────────────────────────────────────────────────────────┘

Flow: Query → Endpoint Auth → RLS (filter records) → FLS (limit fields) → Response
```

## Key Decisions (Locked)

| Decision                | Choice                                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| DB storage              | **Branded raw object** (issue #1 shape): `{"__sensitiveValue": T, ...integrity}`; status is **not** stored     |
| Wire format             | **Server-produced envelope** with `status` + `value` + optional `reason` (**stable code**, server-authored)   |
| Authorization primitive | **Discrete requirements/entitlements** evaluated by a user-supplied resolver (zodvex is agnostic)              |
| Default policy          | **Default deny**: if access isn't explicitly allowed, treat the field as hidden                                |
| Policy timing           | Apply policy **immediately after DB reads**; handler receives already-limited `SensitiveField` values          |
| Fail-secure             | Non-secure wrappers auto-limit reads; non-secure mutations/actions reject when sensitive fields are present    |
| Masking                 | Server-side only; mask functions should be pure/deterministic                                                  |
| Leak resistance         | `SensitiveField` uses `getValue()` (no `unwrap()`) + blocks implicit string/primitive coercion                 |
| Value access            | **No `unwrap()` method** - always use `getValue()` which respects the current status. Hidden fields return `null`. |
| Privileged access       | **No escape hatch**: elevation requires a new request with required entitlements (step-up auth is out of scope)|
| Read/Write policies     | Schema defines **both** read and write policies per field; entitlements map to status levels                   |

## Schema-Defined Read AND Write Policies

The schema is the source of truth for both read and write access control:

```ts
const patientSchema = z.object({
  clinicId: z.string(),

  email: sensitive(z.string(), {
    read: [
      { status: 'full', requirements: 'read:patient:pii:full' },
      { status: 'masked', requirements: 'read:patient:pii:masked', mask: maskEmail },
      // No match → 'hidden' (default deny)
    ],
    write: { requirements: 'write:patient:contact' }
  }),

  ssn: sensitive(z.string(), {
    read: [
      { status: 'full', requirements: 'read:patient:ssn:full' },
      { status: 'masked', requirements: 'read:patient:ssn:masked', mask: (v) => `***-**-${v.slice(-4)}` },
    ],
    write: { requirements: 'admin:patient:ssn' }  // Very restricted
  }),

  notes: sensitive(z.string(), {
    read: [
      { status: 'full', requirements: 'read:patient:notes' },
      // No masked level - either full or hidden
    ],
    write: { requirements: 'write:patient:notes' }
  })
})
```

### Resolution Logic

**For reads:** Check policies in order (full first, then masked). First match wins. No match → hidden.

**For writes:** Check write requirement. If entitlement missing → reject mutation.

### Reason Codes (Stable, Per-Request)

`reason` is an optional **stable code** attached during policy application (not stored in DB).

- Reasons may be **dynamic** (computed per request) and are not limited to static schema metadata.
- Reasons are **server-authored**; clients must not be able to set or influence them via args.
- Prefer stable codes (e.g. `step_up_required`, `missing_entitlement`, `not_assigned`) and map to UI copy client-side.

Resolution precedence (when producing a final `ReadDecision`/`WriteDecision`):

1. Resolver-provided reason (dynamic, request-specific)
2. Policy-tier reason (static, typically attached when the tier matches)
3. Config default reason (e.g. `defaultDenyReason`)

```ts
// Read resolution
async function resolveReadStatus(context, policies, resolver, { defaultDenyReason } = {}) {
  let lastDenyReason

  for (const policy of policies) {
    const check = await resolver({ ...context, operation: 'read' }, policy.requirements)
    const ok = typeof check === 'boolean' ? check : check.ok

    if (ok) {
      return { status: policy.status, mask: policy.mask, reason: policy.reason }
    }

    if (typeof check !== 'boolean' && check.reason) {
      lastDenyReason = check.reason
    }
  }

  return { status: 'hidden', reason: lastDenyReason ?? defaultDenyReason } // Default deny
}

// Write resolution
async function resolveWriteAccess(context, writePolicy, resolver) {
  if (!writePolicy) return { allowed: true }  // No write policy = allow

  const check = await resolver({ ...context, operation: 'write' }, writePolicy.requirements)
  const allowed = typeof check === 'boolean' ? check : check.ok
  return { allowed, reason: typeof check === 'boolean' ? undefined : check.reason }
}
```

## Representations & Serialization Barriers

Even with "Model B" branded DB storage, the DB shape and wire shape usually differ because:

- DB must store raw value (+ integrity metadata), while
- wire must carry viewer-specific `status/reason` and must not include integrity metadata.

Recommended representations:

1. **DB storage**: `SensitiveDb<T>`

   ```ts
   type SensitiveDb<T> = {
     __sensitiveValue: T;
     __checksum?: string;
     __algo?: string;
   };
   ```

2. **Server runtime**: `SensitiveField<T>`

   - Stores value appropriate to status (full value, masked value, or null for hidden).
   - Carries `status` and `reason` after policy is applied.
   - `getValue()` returns the status-appropriate value (never raw if hidden).

3. **Wire**: `SensitiveWire<TStatus, TValue>` (discriminated by `status`)

   - `value` is full value only when `status` is the "full" status.
   - For "masked", `value` is the masked/derived value.
   - For "hidden", `value` is `null`.

4. **Client runtime**: `SensitiveField<T>` (decoded from wire)

### Why this still looks like "two transforms"

Even if you apply policy once (right after DB read), you still have:

- **DB → runtime**: wrap/verify integrity (and optionally apply policy immediately)
- **runtime → wire**: serialize the already-limited `SensitiveField` for transport

The key optimization is: **don't apply policy twice**. Apply it once (preferably at read time), then serialize.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Layer 2: Reference FLS Implementation                          │
│  (zSecureQuery/Mutation/Action, secure db wrapper, defaults)     │
├─────────────────────────────────────────────────────────────────┤
│  Layer 1: Core Primitives                                       │
│  (sensitive() marker, metadata, applyPolicy, wire/db helpers)   │
├─────────────────────────────────────────────────────────────────┤
│  zodvex Core (existing: mapping, wrappers, tables)              │
└─────────────────────────────────────────────────────────────────┘
```

---

## File Structure

```
src/security/
├── index.ts              # Server exports barrel
├── client.ts             # Client exports (framework-agnostic)
├── sensitive.ts          # sensitive() marker + metadata helpers
├── sensitive-field.ts    # SensitiveField<T> runtime class
├── config.ts             # FLSConfig type + defaults
├── policy.ts             # Resolver types + helpers
├── apply-policy.ts       # applyPolicy() recursive transform
├── wire.ts               # wire envelope helpers (serialize/deserialize)
├── db.ts                 # secure db wrapper helpers (optional but recommended)
├── wrappers.ts           # zSecureQuery, zSecureMutation, zSecureAction
├── fail-secure.ts        # auto-limit + mutation/action guards
└── types.ts              # Shared type definitions
```

---

## Implementation Steps

### 1. Package Setup

**Files:** `package.json`, `tsup.config.ts`

- Add `./security` and `./security/client` subpath exports
- Update tsup entry points: `['src/index.ts', 'src/security/index.ts', 'src/security/client.ts']`

### 2. Core Primitives (Layer 1)

**File:** `src/security/types.ts`

```ts
export type SensitiveDb<T> = {
  __sensitiveValue: T;
  __checksum?: string;
  __algo?: string;
};

	export type SensitiveStatus = string;

	// Stable code attached when producing a decision (server-authored).
	// Implementers can optionally validate this strictly (e.g. z.enum([...])).
	export type ReasonCode = string;

	export type SensitiveWire<TStatus extends SensitiveStatus, TValue> = {
	  __sensitiveField?: string | null;
	  status: TStatus;
	  value: TValue | null;
	  reason?: ReasonCode;
	};

	// Read policy: ordered array, first match wins, default deny (hidden)
	export type ReadPolicy<TReq = unknown> = Array<{
	  status: 'full' | 'masked';
	  requirements: TReq;
	  mask?: (value: unknown) => unknown;
	  reason?: ReasonCode;
	}>;

// Write policy: binary allow/deny based on requirements
export type WritePolicy<TReq = unknown> = {
  requirements: TReq;
};

export type SensitiveMetadata<TReq = unknown> = {
  sensitive: true;
  read?: ReadPolicy<TReq>;
  write?: WritePolicy<TReq>;
  integrity?: { enabled: boolean };
};
```

**File:** `src/security/sensitive.ts`

- `sensitive(innerSchema, options)` marks fields as sensitive and stores metadata via `.meta()`.
- Metadata is the canonical mechanism; path-keyed policies are supported as helper sugar.
- Decision: harden traversal/transform to reliably discover `.meta()` through Zod wrapper/effect types (Option 1). See `todo/meta/README.md:1`.
- Authoring guidance: treat `sensitive()` as the **outer wrapper** for a fully-defined validator. Prefer:
  - `const email = z.string().email(); email: sensitive(email, { ... })`
  - `email: sensitive(z.string().email().min(3), { ... })`

  Avoid chaining Zod “check” methods after `sensitive(...)` (e.g. `sensitive(z.string(), ...).email()`), since many Zod helpers clone schemas and do not preserve metadata.

### Lint-Level Enforcement (Recommended)

Because many Zod “check” helpers (e.g. `.email()`, `.min()`, `.regex()`, etc.) clone schemas and may drop `.meta()`, the easiest enforcement is an ESLint rule that flags unsafe chaining on the return value of `sensitive(...)`.

**Rule idea:** `zodvex-security/no-chain-after-sensitive`

- **Disallow** any member call chained directly off `sensitive(...)`, except a small allowlist of wrapper/effect methods that Option 1 can traverse safely (example allowlist: `optional`, `nullable`, `default`, `catch`, `transform`, `pipe`).
- **Message:** “Apply `sensitive()` to the fully-built schema: `sensitive(z.string().email().min(3), opts)` instead of `sensitive(z.string(), opts).email().min(3)`.”
- **Auto-fix (best effort):** for simple cases `sensitive(A, opts).email()` → `sensitive(A.email(), opts)` (and similar for other method names). For multi-step chains, the rule can either:
  - provide a suggestion only (no fix), or
  - apply a conservative fix for the first call and leave the rest for the developer.

**Why lint instead of types?**
- It keeps schemas as “normal Zod” types (important for reuse and product ergonomics) while still preventing the footgun patterns that can drop `.meta()`.

**How it fits the safety model**
- Option 1 makes `.meta()` discoverable through wrapper/effect types during traversal.
- This lint rule prevents authoring patterns where metadata is dropped by cloning helpers.
- Option 4 fail-closed behavior remains the runtime backstop if something slips through.

```ts
function sensitive<T extends z.ZodTypeAny, TReq = unknown>(
  inner: T,
  options?: {
    read?: ReadPolicy<TReq>;
    write?: WritePolicy<TReq>;
  },
): z.ZodTypeAny;

function isSensitiveSchema(schema: z.ZodTypeAny): boolean;
function getSensitiveMetadata(
  schema: z.ZodTypeAny,
): SensitiveMetadata | undefined;
function findSensitiveFields(
  schema: z.ZodTypeAny,
): Array<{ path: string; meta: SensitiveMetadata }>;
```

**File:** `src/security/policy.ts`

```ts
	export type PolicyContext<TCtx, TReq = unknown, TDoc = unknown> = {
	  ctx: TCtx;
	  path: string;
	  meta: SensitiveMetadata<TReq>;
	  doc?: TDoc;
	  operation: 'read' | 'write';
	};

	export type ReadDecision = {
	  status: 'full' | 'masked' | 'hidden';
	  reason?: ReasonCode;
	  mask?: (value: unknown) => unknown;
	};

	export type WriteDecision = {
	  allowed: boolean;
	  reason?: ReasonCode;
	};

	export type EntitlementCheckResult =
	  | boolean
	  | { ok: boolean; reason?: ReasonCode };

	// Resolver checks if context has required entitlements.
	// Returning `boolean` is shorthand for `{ ok: boolean }`.
	export type EntitlementResolver<TCtx, TReq = unknown, TDoc = unknown> = (
	  context: PolicyContext<TCtx, TReq, TDoc>,
	  requirements: TReq,
	) => EntitlementCheckResult | Promise<EntitlementCheckResult>;

	// Apply read policies using resolver
	export function resolveReadPolicy<TCtx, TReq, TDoc>(
	  context: PolicyContext<TCtx, TReq, TDoc>,
	  policies: ReadPolicy<TReq>,
	  resolver: EntitlementResolver<TCtx, TReq, TDoc>,
	  options?: { defaultDenyReason?: ReasonCode },
	): Promise<ReadDecision>;

	// Apply write policy using resolver
	export function resolveWritePolicy<TCtx, TReq, TDoc>(
	  context: PolicyContext<TCtx, TReq, TDoc>,
	  policy: WritePolicy<TReq> | undefined,
	  resolver: EntitlementResolver<TCtx, TReq, TDoc>,
	  options?: { defaultDenyReason?: ReasonCode },
	): Promise<WriteDecision>;
	```

**File:** `src/security/apply-policy.ts`

```ts
// Recursively applies read policy to a value based on schema + sensitive metadata
export async function applyReadPolicy<T, TCtx>(
  value: T,
  schema: z.ZodTypeAny,
  ctx: TCtx,
  resolver: EntitlementResolver<TCtx>,
  options?: { path?: string; doc?: unknown; defaultDenyReason?: ReasonCode },
): Promise<T>;

// Validates write policy for mutation input (throws if denied)
export async function validateWritePolicy<T, TCtx>(
  value: T,
  schema: z.ZodTypeAny,
  ctx: TCtx,
  resolver: EntitlementResolver<TCtx>,
  options?: { path?: string; defaultDenyReason?: ReasonCode },
): Promise<void>;
```

### 3. Runtime Class (Layer 2)

**File:** `src/security/sensitive-field.ts`

- Mirror Hotpot ergonomics: value storage + anti-coercion.
- `getValue()` returns the status-appropriate value (full, masked, or null for hidden).
- **No `unwrap()` method** - elevation requires new request with entitlements.

```ts
class SensitiveField<T, TStatus extends string = string> {
  static full<T>(value: T, field?: string): SensitiveField<T>;
  static masked<T>(
    maskedValue: T,
    field?: string,
    reason?: ReasonCode,
  ): SensitiveField<T>;
  static hidden<T>(field?: string, reason?: ReasonCode): SensitiveField<T>;

  get status(): TStatus;
  get field(): string | undefined;
  get reason(): ReasonCode | undefined;

  // Returns the status-appropriate value:
  // - 'full': returns full value
  // - 'masked': returns masked value
  // - 'hidden': returns null
  getValue(): T | null;

  // Used at the wire boundary
  toWire(): {
    status: TStatus;
    value: T | null;
    reason?: ReasonCode;
    __sensitiveField?: string | null;
  };

  // Anti-coercion guards
  toString(): string;  // Returns placeholder, logs warning
  valueOf(): string;
  [Symbol.toPrimitive](): string;
}
```

### 4. Secure Wrappers + Fail-secure Defaults (Layer 2)

**File:** `src/security/wrappers.ts`

- Add endpoint-level authorization (`requiredEntitlements`/`authorize`) and make it throw a Convex-friendly error.
- Default to "no plaintext without authorization": handler sees already-limited `SensitiveField` values.
- For mutations: validate write policies before allowing field modifications.
- Provide hooks for audit logging and for integrity verification.

```ts
type Authorize<TCtx, TArgs> = (ctx: TCtx, args: TArgs) => void | Promise<void>

type SecureQueryOptions<TCtx, TArgs, TStatus extends string> = {
  authorize?: Authorize<TCtx, TArgs>
  entitlementResolver: EntitlementResolver<TCtx>
  audit?: (ctx: TCtx, accessed: Array<{ path: string; status: TStatus }>) => void | Promise<void>
  onDenied?: (info: { kind: 'endpoint' | 'field'; path?: string }) => Error
}

type SecureMutationOptions<TCtx, TArgs, TStatus extends string> = {
  authorize?: Authorize<TCtx, TArgs>
  entitlementResolver: EntitlementResolver<TCtx>
  audit?: (ctx: TCtx, written: Array<{ path: string; allowed: boolean }>) => void | Promise<void>
  onDenied?: (info: { kind: 'endpoint' | 'field'; path?: string }) => Error
}

export function zSecureQuery(...)    // Applies read policies
export function zSecureMutation(...) // Checks write policies before allowing field modifications
export function zSecureAction(...)
```

**File:** `src/security/fail-secure.ts`

```ts
// Auto-limit all sensitive fields to hidden (safe default for standard zQuery)
export function autoLimit<T>(value: T, schema: z.ZodTypeAny): T;

// Throw if schema contains sensitive fields (safe default for standard zMutation/zAction)
export function assertNoSensitive(schema: z.ZodTypeAny): void;

// Check write policies for mutation input (throws if any field denied)
export function assertWriteAllowed<TCtx, TReq>(
  value: unknown,
  schema: z.ZodTypeAny,
  ctx: TCtx,
  resolver: EntitlementResolver<TCtx, TReq>,
): Promise<void>;
```

### 5. Client Utilities

**File:** `src/security/client.ts`

- Keep this framework-agnostic: no React dependency.
- Provide `deserializeWire()` + `serializeWire()` + a `WithSensitiveFields<T>` helper type.

### 6. Testing Plan

1. **Unit tests** (`__tests__/security/`)

   - `sensitive.test.ts` - metadata tagging + detection with read/write policies
   - `apply-policy.test.ts` - nested objects/arrays + read policy resolution + write policy validation
   - `wire.test.ts` - discriminated envelope invariants
   - `sensitive-field.test.ts` - getValue() behavior, coercion guards, no unwrap

2. **Integration tests**

   - `wrappers.test.ts` - authorize() + read policy application + write policy enforcement
   - `fail-secure.test.ts` - autoLimit + assertNoSensitive + assertWriteAllowed

3. **Regression focus**
   - Unions/optionals/arrays: ensure sensitive fields can't escape transform coverage.
   - Write policy enforcement across nested structures.

---

## Hotpot Alignment Notes (for this engagement)

- Endpoint gating matches current usage (`assertEntitlements`) in `hotpot/convex/hotpot/security.ts`.
- DB branded storage matches issue #1 and supports integrity metadata (issues #14/#23).
- `zSecureAction` is needed to match issue #20.
- Audit hooks should make it hard to bypass audit logging requirements (issue #24).
- Read/write policies per field extends current Hotpot model (which only has clearance-based reads).

---

## Future Extension: Integrity Hashing (Issues #14/#23)

**Scope**: Deferred to a future phase after core FLS is stable.

**Context**: Hotpot requires tamper detection for sensitive fields via checksums stored alongside values.

### Requirements (from GitLab issues)

**Issue #14 - Write-side**:
- On every write to a sensitive field:
  1. Get the hashing key (project-wide hardcoded for MVP)
  2. Produce a hash of the value
  3. Store the hash alongside the value in `SensitiveDb<T>`

**Issue #23 - Read-side**:
- On every read:
  1. Read the hashing key
  2. Read the `SensitiveDb<T>` value
  3. Verify the hash matches
  4. If mismatch → raise error (fail closed)

### Design Considerations

1. **DB shape extension**:
   ```ts
   type SensitiveDb<T> = {
     __sensitiveValue: T
     __checksum?: string   // HMAC or hash of value
     __algo?: string       // Algorithm identifier (future-proofing)
   }
   ```

2. **Integration points**:
   - Write: Hook in `zSecureMutation` before DB insert/update
   - Read: Hook in secure DB wrapper after read, before `SensitiveField` creation
   - Both should be optional/configurable per deployment

3. **Key management**: Out of scope for zodvex - consumer provides key retrieval function

4. **Algorithm selection**: Start with HMAC-SHA256, make configurable

### Exploration Tasks

- [ ] Research Convex-compatible hashing (must work in Convex runtime)
- [ ] Design `IntegrityConfig` type for zodvex
- [ ] Determine if integrity verification should block or warn
- [ ] Consider performance implications of hashing on every read/write
