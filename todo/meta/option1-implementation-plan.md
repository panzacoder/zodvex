# Option 1 Implementation Plan: Traversal Unwrap (with Option 4 safety net)

## Goal

Make sensitivity marking via `.meta()` reliable across Zod wrapper/effect types, so schema traversal and value transforms cannot “miss” sensitive fields due to composition order (e.g. `sensitive(z.string()).transform(...)`).

This plan assumes:
- **Primary:** Option 1 (Traversal Unwrap)
- **Safety net:** Option 4 runtime orphan detection defaults to **hard fail**

## Scope

Update **transform primitives** so *all* downstream consumers (security layer, future tooling) inherit the fix:
- `src/transform/traverse.ts` (`getMetadata`, `hasMetadata`, `walkSchema`, `findFieldsWithMeta`)
- `src/transform/transform.ts` (`transformBySchema`, `transformBySchemaAsync`)

## Implementation Checklist

### 1) Identify and standardize “unwrap” behavior

- Add a helper that can unwrap wrapper/effect nodes to an “inner” schema:
  - `optional` / `nullable` (already supported via `.unwrap()`)
  - `lazy` (already supported via `_def.getter()`)
  - **effect/wrapper types** to support (start with these; confirm actual `_def.type` strings in our pinned Zod version):
    - `transform`
    - `refine` / `effects` (depending on Zod internals)
    - `pipe`
    - `default`
    - `catch`
    - `readonly`
    - `brand` (if present)
    - `prefault`
    - `nonoptional`

Design constraints:
- Unwrap must be **recursive** (wrappers can stack).
- Unwrap must be **loop-safe** (combine with existing `visited` set behavior).
- Prefer a single helper used by both traversal and transform so behavior cannot drift.

### 2) Fix metadata discovery (root of the vulnerability)

- Update `getMetadata(schema)` to:
  1) check `schema.meta?.()` on the current node
  2) if none, unwrap to inner schema (if possible) and retry
  3) stop when no further unwrapping is possible

### 3) Fix traversal coverage

- Update `walkSchema()` recursion in `src/transform/traverse.ts` to unwrap and recurse into wrapper/effect types, so:
  - `findFieldsWithMeta()` can discover sensitive fields regardless of wrapper composition order.

### 4) Fix value transformation coverage

- Update `transformBySchema()` and `transformBySchemaAsync()` to unwrap and recurse into wrapper/effect types, so:
  - policy application cannot miss sensitive fields because the schema node is an unhandled wrapper.

### 5) Tests (regressions that must pass)

Add/extend tests in:
- `__tests__/transform/traverse.test.ts:1`
  - Sensitive meta is discoverable through each wrapper/effect type listed above.
  - Nested wrappers work (e.g. `sensitive(...).default(...).transform(...)`).
- `__tests__/transform/transform.test.ts:1`
  - Transform callback sees sensitive meta through wrappers.
  - Transform recursion still reaches children under wrapped object/array schemas.

Additionally (security-facing regression):
- `__tests__/security/*.test.ts` as needed to ensure apply-policy still finds and limits sensitive fields when schemas contain transforms/refines/pipes around sensitive fields.

### 6) Hard-fail safety net (required for PHI posture)

If not already present (or if currently configurable to fail-open), ensure the security layer has:
- Runtime detection of orphaned `SensitiveDb` values (`__sensitiveValue`) not covered by schema marking
- Default mode: **throw**

This is what converts “unknown Zod wrapper type” into fail-closed behavior.

## Rollout Notes

- While Option 1 is being implemented, continue to treat “meta must be applied after transform/refine” as a temporary footgun (documented in `todo/pre-migration-assessment.md:139`).
- After completion, update docs to remove/relax that guidance and point to the invariant: “sensitive marking is stable across wrappers.”

