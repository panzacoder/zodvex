# Meta Analysis: `.meta()` Vulnerability Options

## The Problem

The current FLS implementation uses Zod's `.meta()` API to mark sensitive fields:

```typescript
sensitive(z.string())  // → z.string().meta({ 'zodvex:sensitive': {...} })
```

**Vulnerability:** Metadata is lost when wrapped by transforms:

```typescript
sensitive(z.string()).transform(s => s.toLowerCase())
// ZodTransform wraps the schema - metadata is hidden inside!
// Traversal sees ZodTransform, not the metadata
```

## Decision

**Primary fix:** **Option 1 (Traversal Unwrap)**

- Preserve the intended Zod ergonomics: `sensitive(z.string()).optional()`, `sensitive(z.string()).transform(...)`, etc.
- Keep the schema as “normal Zod” (no custom Zod type) so other tooling stays simpler.

**Required safety net:** **Option 4 (Runtime Detection)**

- Default to **hard fail** on “orphaned” sensitive DB values that are not covered by schema marking/traversal.
- This converts “missed traversal case” from a potential confidentiality issue into an operational error (fail-closed).

**Deferred:** Option 2 (Wrapper Type)

- Revisit only if Option 1 becomes too costly to maintain across Zod versions, or if we need the wrapper-type guarantees.

**Keep as a documented add-on:** Option 3 (Path Policies)

- Useful for centralized/override policies and per-context variations, but not the primary source of truth.

## Option Comparison

| Option | Approach | Transform-Safe | DX | Maint. | Security |
|--------|----------|----------------|-----|--------|----------|
| **1. Traversal Unwrap** | Expand traversal to handle effect types | ✅ | ✅ Easy | ⚠️ Zod coupling | ⚠️ Edge cases |
| **2. Wrapper Type** | Custom `ZodSensitive<T>` class | ✅ | ✅ Explicit | ⚠️ Custom class | ✅ Robust |
| **3. Path Policies** | External policy config by path | ✅ | ⚠️ Two places | ⚠️ Path sync | ⚠️ Drift risk |
| **4. Runtime Detection** | Detect orphaned sensitive values | ⚠️ After-fact | ⚠️ Errors | ✅ Additive | ✅ Fail-secure |

## Quick Decision Guide

### Choose Option 1 (Traversal Unwrap) if:
- You want minimal API changes
- You're comfortable with Zod internal coupling
- The current `sensitive()` API is what users expect

### Choose Option 2 (Wrapper Type) if:
- Security robustness is top priority
- You can accept slight API changes
- You want `instanceof` detection reliability

### Choose Option 3 (Path Policies) if:
- Policies need to vary by context
- You want dynamic policy loading
- Auditing/compliance requires centralized policies

### Choose Option 4 (Runtime Detection) if:
- As an ADDITION to another option
- You want defense-in-depth
- You need to catch edge cases other options miss

## Recommended Approach

**Primary:** Option 1 (Traversal Unwrap)
**Secondary:** Option 4 (Runtime Detection) as a safety net
**Optional:** Option 3 (Path Policies) for advanced use cases

## File Index

| File | Description |
|------|-------------|
| [`option1-traversal-unwrap.md`](option1-traversal-unwrap.md) | Expand traversal to handle effect types (includes diagram) |
| [`option2-wrapper-type.md`](option2-wrapper-type.md) | Custom ZodSensitive wrapper class (includes diagram) |
| [`option3-path-policies.md`](option3-path-policies.md) | External policy configuration by path (includes diagram) |
| [`option4-runtime-detection.md`](option4-runtime-detection.md) | Runtime detection + fail-secure (includes diagram) |

## Implementation Effort Estimates

| Option | Effort | Risk |
|--------|--------|------|
| Option 1 | 2-3 days | Medium |
| Option 2 | 3-5 days | Low |
| Option 3 | 2-3 days | Medium |
| Option 4 | 1-2 days | Low (additive) |

## Next Steps

Follow the implementation checklist in `todo/meta/option1-implementation-plan.md:1`.
