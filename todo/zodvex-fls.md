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

- [ ] `sensitive(z.*)` maps to DB shape `v.object({ __sensitiveValue: ... })` (incl. `.optional()`, arrays, nesting, and unions)
- [ ] End-to-end: DB raw → server `SensitiveField` → apply policy once (default deny) → wire envelope → client decode
- [ ] Unions/discriminated unions cannot bypass sensitive traversal/transforms (fail closed)
- [ ] “Policy before handler” semantics work for typical handlers, or define an explicit privileged-read escape hatch

## Key Decisions (Locked)

| Decision                | Choice                                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| DB storage              | **Branded raw object** (issue #1 shape): `{"__sensitiveValue": T, ...integrity}`; status is **not** stored     |
| Wire format             | **Server-produced envelope** with `status` + `value` + optional `reason`                                       |
| Authorization primitive | **Discrete requirements/entitlements** evaluated by a user-supplied resolver (zodvex is agnostic)              |
| Default policy          | **Default deny**: if access isn't explicitly allowed, treat the field as hidden/forbidden                      |
| Policy timing           | Default: apply policy **immediately after DB reads**; handler receives already-limited `SensitiveField` values |
| Fail-secure             | Non-secure wrappers auto-limit reads; non-secure mutations/actions reject when sensitive fields are present    |
| Masking                 | Server-side only; mask functions should be pure/deterministic                                                  |
| Leak resistance         | `SensitiveField` stores raw in a `WeakMap` + blocks implicit string/primitive coercion (Hotpot pattern)        |

## Client Decisions Needed (Ask)

These are not “hard problems”, but they’re choices worth confirming with the client:

1. **Where do per-field requirements live?**

   - **Schema metadata** (recommended): requirements colocated with the field definition.
   - **Path-keyed policy map** (supported): requirements live in a separate map keyed by `"patients.ssn"`, etc.
   - Supporting _both_ is not over-engineering if we make one canonical (metadata) and the other a small helper.

2. **DB wrapper exact shape for integrity**

   - Minimal: `{ __sensitiveValue: T }`
   - Integrity-ready (issues #14/#23): `{ __sensitiveValue: T, __checksum: string, __algo?: string }`

3. **Status vocabulary**
   - Default: `full | masked | hidden` (library-friendly)
   - Hotpot: `whole | redacted | restricted | forbidden` (existing behavior)
   - This should be configurable (`createFLSConfig`).

## Representations & Serialization Barriers

Even with “Model B” branded DB storage, the DB shape and wire shape usually differ because:

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

   - Holds the raw value in a `WeakMap`.
   - Carries `status` and `reason` after policy is applied.

3. **Wire**: `SensitiveWire<TStatus, TValue>` (discriminated by `status`)

   - `value` is full value only when `status` is the “full” status.
   - For “masked”, `value` is the masked/derived value.
   - For “hidden/forbidden”, `value` is `null`.

4. **Client runtime**: `SensitiveField<T>` (decoded from wire)

### Why this still looks like “two transforms”

Even if you apply policy once (right after DB read), you still have:

- **DB → runtime**: wrap/verify integrity (and optionally apply policy immediately)
- **runtime → wire**: serialize the already-limited `SensitiveField` for transport

The key optimization is: **don’t apply policy twice**. Apply it once (preferably at read time), then serialize.

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

export type SensitiveWire<TStatus extends SensitiveStatus, TValue> = {
  __sensitiveField?: string | null;
  status: TStatus;
  value: TValue | null;
  reason?: string;
};

export type SensitiveMetadata<TReq = unknown> = {
  sensitive: true;
  requirements?: TReq;
  mask?: (value: unknown) => unknown;
  // Optional: integrity config (hash algo selection, etc.)
  integrity?: { enabled: boolean };
};
```

**File:** `src/security/sensitive.ts`

- `sensitive(innerSchema, options)` marks fields as sensitive and stores metadata via `.meta()`.
- Metadata is the canonical mechanism; path-keyed policies are supported as helper sugar.

```ts
function sensitive<T extends z.ZodTypeAny, TReq = unknown>(
  inner: T,
  options?: { requirements?: TReq; mask?: (v: z.infer<T>) => z.infer<T> },
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
export type PolicyContext<
  TCtx,
  TStatus extends string,
  TReq = unknown,
  TDoc = unknown,
> = {
  ctx: TCtx;
  path: string;
  meta: SensitiveMetadata<TReq>;
  doc?: TDoc;
  rawValue: unknown;
};

export type PolicyDecision<TStatus extends string> = {
  status: TStatus;
  reason?: string;
  mask?: (value: unknown) => unknown;
};

export type PolicyResolver<
  TCtx,
  TStatus extends string,
  TReq = unknown,
  TDoc = unknown,
> = (
  context: PolicyContext<TCtx, TStatus, TReq, TDoc>,
) => PolicyDecision<TStatus> | Promise<PolicyDecision<TStatus>>;

// Optional helper: build a resolver from a path-keyed map
// NOTE: This helper should be fail-closed (default deny) for unknown paths.
export function policyFromPathMap<TCtx, TStatus extends string>(
  map: Record<string, any>,
): PolicyResolver<TCtx, TStatus>;
```

**File:** `src/security/apply-policy.ts`

```ts
// Recursively applies policy to a value based on schema + sensitive metadata
export async function applyPolicy<T, TCtx, TStatus extends string>(
  value: T,
  schema: z.ZodTypeAny,
  ctx: TCtx,
  resolver: PolicyResolver<TCtx, TStatus>,
  options?: { path?: string; doc?: unknown },
): Promise<T>;
```

### 3. Runtime Class (Layer 2)

**File:** `src/security/sensitive-field.ts`

- Mirror Hotpot ergonomics: `WeakMap` value storage + anti-coercion.
- `unwrap()` should throw unless `status` is the configured “full/whole” status.

```ts
class SensitiveField<T, TStatus extends string> {
  static full<T>(value: T, field?: string): SensitiveField<T, any>;
  static masked<T>(
    maskedValue: T,
    field?: string,
    reason?: string,
  ): SensitiveField<T, any>;
  static hidden<T>(field?: string, reason?: string): SensitiveField<T, any>;

  get status(): TStatus;
  get field(): string | undefined;
  get reason(): string | undefined;
  unwrap(): T;

  // Used at the wire boundary
  toWire(): {
    status: TStatus;
    value: unknown;
    reason?: string;
    __sensitiveField?: string | null;
  };
}
```

### 4. Secure Wrappers + Fail-secure Defaults (Layer 2)

**File:** `src/security/wrappers.ts`

- Add endpoint-level authorization (`requiredEntitlements`/`authorize`) and make it throw a Convex-friendly error.
- Default to “no plaintext without authorization”: handler sees already-limited `SensitiveField` values.
- Provide hooks for audit logging and for integrity verification.

```ts
type Authorize<TCtx, TArgs> = (ctx: TCtx, args: TArgs) => void | Promise<void>

type SecureOptions<TCtx, TArgs, TStatus extends string> = {
  authorize?: Authorize<TCtx, TArgs>
  policy: PolicyResolver<TCtx, TStatus>
  audit?: (ctx: TCtx, accessed: Array<{ path: string; status: TStatus }>) => void | Promise<void>
  onDenied?: (info: { kind: 'endpoint' | 'field'; path?: string }) => Error
}

export function zSecureQuery(...)
export function zSecureMutation(...)
export function zSecureAction(...)
```

**File:** `src/security/fail-secure.ts`

```ts
// Auto-limit all sensitive fields (safe default for standard zQuery)
export function autoLimit<T>(value: T, schema: z.ZodTypeAny): T;

// Throw if schema contains sensitive fields (safe default for standard zMutation/zAction)
export function assertNoSensitive(schema: z.ZodTypeAny): void;
```

### 5. Client Utilities

**File:** `src/security/client.ts`

- Keep this framework-agnostic: no React dependency.
- Provide `deserializeWire()` + `serializeWire()` + a `WithSensitiveFields<T>` helper type.

### 6. Testing Plan

1. **Unit tests** (`__tests__/security/`)

   - `sensitive.test.ts` - metadata tagging + detection
   - `apply-policy.test.ts` - nested objects/arrays + doc-aware resolver
   - `wire.test.ts` - discriminated envelope invariants
   - `sensitive-field.test.ts` - WeakMap storage, unwrap guards, coercion guards

2. **Integration tests**

   - `wrappers.test.ts` - authorize() throwing + policy application timing
   - `fail-secure.test.ts` - autoLimit + assertNoSensitive

3. **Regression focus**
   - Unions/optionals/arrays: ensure sensitive fields can’t escape transform coverage.

---

## Hotpot Alignment Notes (for this engagement)

- Endpoint gating matches current usage (`assertEntitlements`) in `hotpot/convex/hotpot/security.ts`.
- DB branded storage matches issue #1 and supports integrity metadata (issues #14/#23).
- `zSecureAction` is needed to match issue #20.
- Audit hooks should make it hard to bypass audit logging requirements (issue #24).
