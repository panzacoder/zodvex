# Codegen Fixes Design

**Date:** 2026-03-03
**Source:** Hotpot MR !110 code review

## Issues

### A. Model deduplication in discovery (issues 1 & 3 from MR review)

**Problem:** `discoverModules()` pushes every model it finds without deduplicating. When a barrel file (`models/index.ts`) re-exports a model already discovered from its direct file, both entries end up in the models array. This causes:

1. **Wrong import source** — `generateApiFile()` uses `models.find()` which returns the first match; glob ordering determines whether the barrel or direct file wins (non-deterministic).
2. **Duplicate exports in schema.ts** — `generateSchemaFile()` emits one export per array entry, producing duplicate identifier exports.

**Fix:** Deduplicate in `discoverModules()` by `tableName`. When a second entry for the same table is found, keep the one from the direct module file (not `index.ts`/barrel). Re-exports share the same runtime object identity, so the `schemas` ref is identical — we're just picking the better `sourceFile`.

**Files:** `packages/zodvex/src/codegen/discover.ts`

### B. Double `.optional()` on update schemas

**Problem:** Update schemas are built by calling `.optional()` on every user field, but fields that are already `.optional()` in the model get double-wrapped: `email: _mc0.optional().optional()`.

**Fix:** Guard with `instanceof z.ZodOptional` check before wrapping. Extract a small helper function used at all 5 sites.

**Files:** `packages/zodvex/src/model.ts` (3 sites), `packages/zodvex/src/tables.ts` (2 sites, plus 1 in union path)

### C. Descriptive model-embedded codec variable names

**Problem:** Generated codec variables use opaque sequential names (`_mc0`, `_mc1`, `_mc2`). The codegen already has the model export name and access path — it just doesn't use them for naming.

**Fix:** Derive names from model export name + `.shape.X` segments in the access path:

1. Strip trailing "Model" suffix, lowercase first char: `UserModel` → `user`, `patients` → `patients`
2. Extract `.shape.X` segments from access path → field names
3. Join in camelCase with `_` prefix: `_userEmail`, `_activityPayloadEmail`
4. Collision = dedup bug (assertion, not counter)

**Files:** `packages/zodvex/src/codegen/generate.ts`

## Testing Strategy

TDD approach — write failing tests that reproduce each issue first, then fix:

- **Fix A:** Add barrel re-export fixture, verify `discoverModules()` deduplicates and `generateSchemaFile()`/`generateApiFile()` use direct sources.
- **Fix B:** Add test with already-optional field, verify update schema doesn't double-wrap.
- **Fix C:** Unit test `deriveCodecVarName()`, verify generated api.ts uses derived names.

## Issue 4 (PatchRule) — Not Fixing

`PatchRule<Ctx, Doc>` uses `Partial<Doc>` which technically includes `_id`. We determined this is correct: identity is established through the `doc` parameter (second arg), not through `value`. The type matches Convex's own `PatchValue<Document>` where system fields are present but optional. The runtime (`RulesDatabaseWriter.patch()`) resolves identity separately via `db.get(id)`.
