# zodvex Open Items

Non-blocking improvements tracked for future work.

## 1. Watch mode debouncing (`zodvex dev`)

`src/cli/commands.ts` — the dev watcher triggers regeneration immediately on every file change with no debounce. Rapid edits (multi-file saves, IDE formatting) cause unnecessary thrashing.

**Fix:** Add 300-500ms debounce timer that resets on each new file change event.

## 2. Pagination wrapper in generated registry

`examples/task-manager/convex/_zodvex/api.ts` — `tasks:list` returns uses inline `z.object(...)` for the pagination wrapper shape (`{ page, isDone, continueCursor }`). Only the `page` array items get `TaskModel` treatment.

**Fix:** Either define a `zPaginated(itemSchema)` helper that codegen can reference, or accept this as a known limitation of ad-hoc return shapes.

## 3. `defineZodModel` union schema overload

`src/model.ts` — `defineZodModel` currently only accepts `z.ZodRawShape` (object fields). The `FieldPaths` type already handles union distribution correctly at the type level, but there's no overloaded function signature for pre-built `z.ZodUnion` or `z.ZodObject` as the second argument.

**Fix:** Add overload accepting pre-built schema. Covers <5% of use cases (polymorphic tables).
