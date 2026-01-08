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

**Primary:** Option 1 or Option 2 (fixes the root cause)
**Secondary:** Option 4 (safety net for edge cases)
**Optional:** Option 3 (for advanced use cases)

## File Index

| File | Description |
|------|-------------|
| [`option1-traversal-unwrap.md`](option1-traversal-unwrap.md) | Full analysis of traversal fix |
| [`option1-traversal-unwrap.mmd`](option1-traversal-unwrap.mmd) | Mermaid diagram |
| [`option2-wrapper-type.md`](option2-wrapper-type.md) | Full analysis of wrapper approach |
| [`option2-wrapper-type.mmd`](option2-wrapper-type.mmd) | Mermaid diagram |
| [`option3-path-policies.md`](option3-path-policies.md) | Full analysis of path-based policies |
| [`option3-path-policies.mmd`](option3-path-policies.mmd) | Mermaid diagram |
| [`option4-runtime-detection.md`](option4-runtime-detection.md) | Full analysis of runtime detection |
| [`option4-runtime-detection.mmd`](option4-runtime-detection.mmd) | Mermaid diagram |

## Implementation Effort Estimates

| Option | Effort | Risk |
|--------|--------|------|
| Option 1 | 2-3 days | Medium |
| Option 2 | 3-5 days | Low |
| Option 3 | 2-3 days | Medium |
| Option 4 | 1-2 days | Low (additive) |
