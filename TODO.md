# zodvex TODO

Tracked improvements and future work.

## Active

### Deduplicate `model.ts` and `tables.ts`

Both files independently build doc, docArray, paginatedDoc, update, and insert schemas with similar helper logic. `defineZodModel()` is the preferred path; `zodTable()` is deprecated. Consolidating the shared schema-construction logic would reduce maintenance cost and prevent bug-fix drift.

### Reorganize `src/` structure

Root of `src/` mixes current public implementation, deprecated compatibility layers, and internal helpers. Natural groupings exist (codec layer, function-builder layer, DB/rules layer) but aren't reflected in the layout. See `packages/zodvex/CLEANUP_AUDIT.md` for detailed analysis.

### Clarify deprecated API surface

`zodTable()`, builder functions (`zQueryBuilder`, etc.), `zid()`, `convexCodec()`, and `mapDateFieldToNumber()` are all deprecated but still exported from `zodvex/server`. Since the package is pre-1.0, consider removing rather than carrying indefinitely.

## Future

### Performance benchmarks

Measure schema conversion time, runtime validation overhead, and memory usage. Compare against native Convex validators.

### API documentation site

TypeDoc or similar for auto-generated API reference from JSDoc comments.

## Done

- ~~zid double-branding~~ — Fixed (type-level branding only)
- ~~Example projects~~ — `examples/task-manager`, `examples/task-manager-mini`, `examples/quickstart`, `examples/stress-test`
- ~~DB-level wrapper~~ — `initZodvex()` with `wrapDb: true`
- ~~Zod codec integration~~ — Native codec support via `zx.codec()` and `z.codec()`
- ~~Custom codec registry~~ — `zx.codec()` replaces `registerBaseCodec()`
- ~~Migration guide~~ — `MIGRATION.md`
- ~~zod/mini compatibility~~ — v0.7.0
