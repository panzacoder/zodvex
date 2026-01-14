# Hotpot Migration Guide (Phase 4): zodvex Security → hotpot

**Status:** MIGRATION COMPLETE

> The security module has been copied to hotpot. See `packages/hotpot/src/security/` and `packages/hotpot/SECURITY_MIGRATION.md` in the hotpot repo for next steps.

This guide operationalizes the Phase 4 checklist from `todo/pre-migration-assessment.md:1`.

## Goal

Move the **security layer** into hotpot while keeping **transform primitives** in zodvex:
- **zodvex (OSS)**: `zodvex/transform` only
- **hotpot (internal)**: security layer (`SensitiveDb/SensitiveField/SensitiveWire`, FLS/RLS wrappers, db wrappers, audit hooks)

## Preconditions

- Confirm the zodvex version you’ll depend on includes the finalized transform subpath export: `zodvex/transform`.
- Confirm whether zodvex will ship its `./security` exports publicly or whether those are temporary for development:
  - If security is meant to remain internal for now, plan to remove `./security` exports before publishing zodvex.

## Step 1: Copy Security Files into hotpot

Copy from `zodvex/src/security/` to `hotpot/packages/hotpot/src/security/`:

```
packages/hotpot/src/security/
├── index.ts
├── client.ts
├── types.ts
├── sensitive.ts
├── sensitive-field.ts
├── policy.ts
├── apply-policy.ts
├── wire.ts
├── fail-secure.ts
├── rls.ts
├── db.ts
└── secure-wrappers.ts
```

## Step 2: Rewrite Imports to Use zodvex/transform

In the copied hotpot security files, update imports like:
- `../transform` → `zodvex/transform`

Examples:
- `sensitive.ts`: `findFieldsWithMeta/getMetadata/hasMetadata`
- `apply-policy.ts`: `transformBySchemaAsync`
- `fail-secure.ts`: `transformBySchema`

## Step 3: Add zodvex Dependency to hotpot

In `packages/hotpot/package.json`:
- add `zodvex` as a dependency

Also ensure your bundler/build config in hotpot is set to keep `zodvex/transform` as an external (or otherwise doesn’t bundle in unintended code).

## Step 4: Add hotpot Package Exports for Security

In `packages/hotpot/package.json`:
- add `./security` and `./security/client` exports that point at hotpot’s build output.

## Step 5: Bring Over/Adapt Tests

Minimum recommended:
- Copy the security unit tests from zodvex and adapt paths/build as needed.
- Ensure at least these behaviors remain covered:
  - Fail-closed resolver behavior
  - Fail-closed union mismatch behavior
  - Orphaned `SensitiveDb` detection defaulting to throw (PHI posture)
  - RLS denial observability (`onDenied`)
  - Wire serialization/deserialization invariants

## Step 6: Proof-of-Concept Endpoint Migration

Migrate at least one hotpot function end-to-end as a proof of concept:
- Replace old sensitive validator walking (`VSensitive`/`walkVSensitive` patterns) with the new security wrappers and schema-defined policies.
- Confirm:
  - DB storage stays branded (`__sensitiveValue`)
  - read-time policy application happens immediately after DB read (handler sees already-limited values)
  - audit hook captures PHI field egress events

## Step 7: Tree-Shaking / Bundling Sanity Check

Verify that importing hotpot security does not pull all of zodvex:
- Confirm `zodvex/transform` is the only used surface in hotpot security.
- Confirm hotpot build output does not include duplicate copies of zod or unrelated zodvex modules.

## Step 8: Documentation Updates

- Update hotpot docs to describe:
  - how to author schemas with `sensitive(inner, { read, write })`
  - how/where policies are enforced (server-only, read-time)
  - what the client receives (wire envelope) and how it is decoded
  - required audit logging for PHI field egress

## Step 9: Post-Migration Cleanup in zodvex (when ready)

Once hotpot is migrated and stable:
- remove `src/security/` from zodvex
- remove `./security` and `./security/client` exports
- keep and document `./transform`

