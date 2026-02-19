# Hotpot Migration Guide: transforms.output → onSuccess

> **Context:** zodvex is removing its custom hooks/transforms system in favor of convex-helpers' `onSuccess` convention. This guide covers the hotpot-side changes needed before zodvex can remove the transforms code paths.

**Scope:** Minimal — swap `transforms.output` for `onSuccess` in two files. No changes to SecureReader/Writer, audit logger, or security logic.

**Why this works:** The audit logger (`convex/hotpot/security/audit/logger.ts:131-148`) already supports both `SensitiveField` instances (pre-validation) and `SensitiveWire` objects (post-validation). Moving from `transforms.output` (pre-validation) to `onSuccess` (post-validation) changes the data format the logger sees, but both formats are already handled.

---

## Changes

### 1. `convex/hotpot/queries.ts`

**A. Update `hotpotQueryCustomization` return type** (lines 56-59)

```typescript
// BEFORE
function hotpotQueryCustomization(
  fn: (ctx: QueryCtx) => Promise<{
    ctx: HotpotQueryCtx
    transforms?: { output?: (result: unknown) => unknown }
  }>,
)

// AFTER
function hotpotQueryCustomization(
  fn: (ctx: QueryCtx) => Promise<{
    ctx: HotpotQueryCtx
    onSuccess?: (info: { ctx: unknown; args: Record<string, unknown>; result: unknown }) => void
  }>,
)
```

**B. Update `hotpotQueryCustomization` input return** (line 75)

```typescript
// BEFORE
return { ctx: result.ctx, args: {}, transforms: result.transforms }

// AFTER
return { ctx: result.ctx, args: {}, onSuccess: result.onSuccess }
```

**C. Update `hotpotQuery` customization body** (lines 119-130)

```typescript
// BEFORE
return {
  ctx: { db, securityCtx } as HotpotQueryCtx,
  transforms: {
    output: (result: unknown) => {
      produceReadAuditLog(securityCtx, result)
      return result
    },
  },
}

// AFTER
return {
  ctx: { db, securityCtx } as HotpotQueryCtx,
  onSuccess: ({ result }: { ctx: unknown; args: Record<string, unknown>; result: unknown }) => {
    produceReadAuditLog(securityCtx, result)
  },
}
```

**D. Update comments** (lines 47-53, 51-53, 98, 122-123)

Remove references to `transforms.output` timing. The new comments should say:

```typescript
/**
 * Create a customization that supports extra args (like `required`).
 *
 * Uses onSuccess for audit logging. The audit logger supports both
 * SensitiveField instances and SensitiveWire objects.
 */
```

---

### 2. `convex/hotpot/mutations.ts`

Identical pattern to queries.ts:

**A. Update `hotpotMutationCustomization` return type** (lines 57-61)

```typescript
// BEFORE
function hotpotMutationCustomization(
  fn: (ctx: MutationCtx) => Promise<{
    ctx: HotpotMutationCtx
    transforms?: { output?: (result: unknown) => unknown }
  }>,
)

// AFTER
function hotpotMutationCustomization(
  fn: (ctx: MutationCtx) => Promise<{
    ctx: HotpotMutationCtx
    onSuccess?: (info: { ctx: unknown; args: Record<string, unknown>; result: unknown }) => void
  }>,
)
```

**B. Update `hotpotMutationCustomization` input return** (line 77)

```typescript
// BEFORE
return { ctx: result.ctx, args: {}, transforms: result.transforms }

// AFTER
return { ctx: result.ctx, args: {}, onSuccess: result.onSuccess }
```

**C. Update `hotpotMutation` customization body** (lines 120-131)

Same as queries — swap `transforms.output` for `onSuccess`.

**D. Update comments** — same as queries.

---

## What does NOT change

| Component | Why unchanged |
|-----------|---------------|
| `SecureReader` / `SecureWriter` | DB wrapping logic is independent of function-level hooks |
| Audit logger (`audit/logger.ts`) | Already handles both SensitiveField and SensitiveWire formats |
| `extra` args / `required` entitlements | Flows through customization `input(ctx, args, extra)` unchanged |
| `zCustomQueryBuilder` / `zCustomMutationBuilder` | API unchanged — zodvex still accepts `onSuccess` on the `input` return |
| `scopeQuery` / `scopeMutation` | Don't use transforms |
| `zq` / `zm` / `ziq` / `zim` | Plain builders, don't use transforms |
| Client-side code (React hooks, vanilla client) | No function-level hooks involved |

---

## Behavioral difference

**Before:** `produceReadAuditLog` receives the handler's return value with `SensitiveField` class instances (pre-validation). The logger uses `isSensitiveFieldInstance()` to detect them.

**After:** `produceReadAuditLog` receives the validated return value with `SensitiveWire` plain objects (post-validation). The logger uses `isSensitiveWireObject()` to detect them.

Both paths produce identical audit entries — same table, same field names, same access status. The logger was designed to handle both formats (`logger.ts:187-189`).

**One edge case:** If a handler has no `returns` schema, `onSuccess` receives unvalidated data (still `SensitiveField` instances). The logger handles this too. But hotpot queries/mutations always specify `returns`, so this path isn't exercised.

---

## Verification

After making the changes:

```bash
# In hotpot repo
bun test tests/roundTrip.test.ts  # Verify SecureReader/Writer still work
bun test                           # Full suite
bun run type-check                 # Ensure type signatures are correct
```

The audit log output should be identical before and after migration.

---

## Future: `initZodvex` adoption

This migration is intentionally minimal — it only removes the `transforms` dependency so zodvex can proceed with the hooks removal.

A separate exploration will cover adopting `initZodvex` in hotpot, which would:
- Replace `zCustomQueryBuilder`/`zCustomMutationBuilder` with `zq.withContext()`
- Potentially integrate zodvex's codec layer with hotpot's `SecureReader`/`SecureWriter`
- Simplify the manual builder type parameters

That work is tracked separately and depends on the composition layer (`initZodvex`) being shipped first.
