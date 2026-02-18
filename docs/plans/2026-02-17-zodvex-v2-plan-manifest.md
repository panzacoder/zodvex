# zodvex v2 Implementation Plan Manifest

**Date:** 2026-02-17
**Design doc:** `docs/plans/2026-02-17-zodvex-v2-redesign.md`
**Decision doc:** `docs/decisions/2026-02-17-runtime-only-middleware.md`
**Branch:** `fix/codec-issues`

---

## Execution Order

Each plan builds on the previous. Execute in order. Each can run in a separate session.

| # | Plan | Focus | Risk Level | Depends On |
|---|------|-------|------------|------------|
| 1 | [Pipeline Ordering Fix](./2026-02-17-zodvex-v2-plan-1-pipeline-ordering.md) | Fix `onSuccess` timing bug + 5 de-risking tests | **HIGH** — foundation for everything | None |
| 2 | [initZodvex Redesign](./2026-02-17-zodvex-v2-plan-2-initZodvex-redesign.md) | Replace broken `buildHandler` with `customFnBuilder` delegation | **HIGH** — fixes zero-validation bug | Plan 1 |
| 3 | [DB Codec Simplification](./2026-02-17-zodvex-v2-plan-3-db-codec-simplification.md) | Remove 6-hook-point system, simplify to codec-only | **MEDIUM** — removes public API surface | Plan 2 |
| 4 | [API Cleanup](./2026-02-17-zodvex-v2-plan-4-api-cleanup.md) | Deprecations, deduplication, export updates | **LOW** — non-breaking changes | Plan 3 |
| 5 | [Full Integration + Migration](./2026-02-17-zodvex-v2-plan-5-full-integration.md) | End-to-end test + hotpot migration guide | **LOW** — proves everything works | Plan 4 |

## Key Files Modified Per Plan

### Plan 1 (Pipeline Ordering)
- `src/custom.ts` — fix `onSuccess` position in `customFnBuilder`
- `__tests__/pipeline-ordering.test.ts` — NEW, 5 de-risking tests

### Plan 2 (initZodvex Redesign)
- `src/init.ts` — full rewrite, delegate to `customFnBuilder`
- `__tests__/init.test.ts` — updated for new API
- `__tests__/integration/codec-pipeline.test.ts` — updated for new API

### Plan 3 (DB Codec Simplification)
- `src/db/hooks.ts` — gutted to just `WireDoc`/`RuntimeDoc` types
- `src/db/wrapper.ts` — simplified (remove hooks/ctx params)
- `__tests__/db/wrapper-reader.test.ts` — remove hook tests
- `__tests__/db/wrapper-writer.test.ts` — remove hook tests
- `__tests__/db/hooks.test.ts` — DELETED
- `__tests__/db/decode-benchmark.test.ts` — NEW, performance proof

### Plan 4 (API Cleanup)
- `src/builders.ts` — deprecation notices on `zCustom*Builder`
- `src/custom.ts` — deprecation notices on `customCtxWithHooks` + types
- `__tests__/exports.test.ts` — updated for v2 surface
- `__tests__/pipeline-ordering.test.ts` — deprecation warning tests

### Plan 5 (Full Integration)
- `__tests__/integration/codec-pipeline.test.ts` — capstone integration test
- `docs/guides/hotpot-migration-v2.md` — NEW, migration guide

## Success Criteria

After all 5 plans are complete:
- [ ] Pipeline ordering: `onSuccess` sees Date and SensitiveWrapper instances
- [ ] `initZodvex` builders have full Zod validation (args + returns)
- [ ] DB wrapper is codec-only (no hooks in public API)
- [ ] Consumer wrapper functions compose on top of codec layer
- [ ] Decode cost benchmark passes (<25ms for 1000 docs)
- [ ] All deprecated exports still work with warnings
- [ ] Full test suite passes
- [ ] Type checking passes
- [ ] Build succeeds
- [ ] Hotpot migration guide created

## Not in Scope (Future Work)

- Codegen: validator registry + `_generated/zodvex/` output
- Client-safe model definitions (`zodTable()` uses server-only `defineTable()`)
- `zodvex/transform` package evaluation
- Removal of deprecated exports (future major version)
- Action builders wrapping `ctx.runQuery()`/`ctx.runMutation()` with auto-decode
