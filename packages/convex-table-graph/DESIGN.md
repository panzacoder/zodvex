# convex-table-graph — Design Document

Last updated: 2026-04-17

## Problem Statement

Convex's marquee feature is "realtime just works" — you write a query, subscribe to it, and the UI updates automatically whenever underlying data changes. The developer never declares "this mutation affects that query." Convex's server-side dependency tracking handles it invisibly.

**This magic breaks in exactly one place: optimistic updates.**

The current `withOptimisticUpdate` API requires developers to manually declare which queries a mutation affects and how to patch them:

```ts
const createTask = useMutation(api.tasks.create).withOptimisticUpdate(
  (localStore, args) => {
    // Developer must know every query that shows this data:
    const list = localStore.getQuery(api.tasks.list, {})
    if (list) localStore.setQuery(api.tasks.list, {}, [...list, tempTask])

    const byProject = localStore.getQuery(api.tasks.byProject, { projectId: args.projectId })
    if (byProject) localStore.setQuery(api.tasks.byProject, { projectId: args.projectId }, [...byProject, tempTask])

    // ...miss one and optimistic state is inconsistent
  }
)
```

This is the only Convex API that asks the developer to reason about the reactive graph explicitly. Developers report it feels awkward and out-of-character with the rest of the platform. Most avoid it entirely and accept the 100-300ms latency gap after mutations.

**The static analyzer exists to close this gap: infer what Convex's runtime already knows and expose it to the client, so optimistic updates can "just work" like subscriptions do.**

## Scope

`convex-table-graph` is a build-time static analyzer that extracts function-to-table dependency relationships from a Convex project. It produces a map:

```ts
{
  "tasks:list":       { type: "query",    reads: ["tasks"],                      visibility: "public" },
  "tasks:create":     { type: "mutation", writes: ["tasks"],                     visibility: "public" },
  "tasks:archive":    { type: "mutation", reads: ["tasks"], writes: ["tasks", "auditLog"], visibility: "public" },
  "tasks:byProject":  { type: "query",    reads: ["tasks"],                      visibility: "public" },
}
```

This map is consumable by any tool that wants to reason about which mutations affect which queries. Primary intended consumers:

1. **A smart optimistic updates helper for Convex** — auto-invalidates affected queries on mutation, restoring the "just works" DX
2. **`tanstack-db-convex`** — an offline/persistence adapter that uses the graph to wire collection↔mutation relationships
3. **zodvex's own codegen** — could potentially replace runtime import-based discovery with static AST analysis

The analyzer itself is framework-agnostic, output-only. It has no runtime dependency on any client library.

## Non-Goals

- Runtime tracing or instrumentation — this is strictly static analysis
- Building the optimistic updates helper or TanStack DB adapter — those are separate packages that consume the graph
- Supporting non-Convex codebases — the analyzer is purpose-built for Convex's `ctx.db` API surface
- Inferring join semantics across tables — the analyzer reports which tables a function touches, not how it queries them

## Architecture

### Pipeline Overview

```
convex/ directory
    ↓
File Discovery (glob + exclusion rules)
    ↓
Function Identification (AST — find query/mutation/action wrappers)
    ↓
DB Taint Walk (follow ctx/ctx.db/db through call graph, bounded depth)
    ↓
Table Extraction (string literals, Id<"table"> resolution)
    ↓
Output (JSON + TS module + diagnostics)
```

### Phase 1: File Discovery

Walk the `convex/` directory with inclusion/exclusion rules matching Convex's own bundler:

**Include:** `.ts`, `.tsx`, `.js`, `.mjs`, `.cjs` files in `convex/`

**Exclude:**
- `_generated/` and `_deps/` directories
- `schema.ts` / `schema.js` (bundled separately by Convex)
- Dotfiles and files starting with `#`
- Files with multiple dots (e.g. `foo.test.ts`) — Convex excludes these
- Files with spaces in the path
- Subdirectories containing `convex.config.ts` (component boundaries)

Derive function paths as `{relPath-without-ext}:{exportName}`, matching Convex's `getFunctionName()` format. E.g., `convex/tasks.ts` → `tasks`, `convex/api/reports.ts` → `api/reports`.

### Phase 2: Function Identification

For each file, parse with ts-morph and find exports wrapped in recognized Convex builders:

```ts
// Patterns to detect:
export const list = query({ handler: async (ctx, args) => { ... } })
export const create = mutation({ handler: async (ctx, args) => { ... } })
export const doThing = action({ handler: async (ctx, args) => { ... } })
export const secretQuery = internalQuery({ handler: ... })
export const secretMutation = internalMutation({ handler: ... })
export const secretAction = internalAction({ handler: ... })
export default query({ handler: ... })
```

**Builder recognition** — start with vanilla Convex builders (`query`, `mutation`, `action`, `internalQuery`, `internalMutation`, `internalAction`, `httpAction`). Add configurable support for wrappers (`zQuery`, `zMutation`, custom `customQuery` builders) via a config file:

```ts
// convex-table-graph.config.ts
export default {
  builders: {
    query: ["zQuery", "zInternalQuery", "myAppQuery"],
    mutation: ["zMutation", "zInternalMutation", "myAppMutation"],
    action: ["zAction", "zInternalAction"],
  }
}
```

Extract the `handler` property from the builder's first argument. That function body is the analysis target.

### Phase 3: DB Taint Walk

The core algorithm. For each handler:

1. **Seed taint** — the handler's first parameter (`ctx`) is the taint root. Also seed `ctx.db` and any destructured aliases (`const { db } = ctx`).

2. **Scan for db calls** — walk the handler body looking for member call expressions on tainted symbols:

   ```ts
   db.query("tasks")      // READ — table is string literal arg 0
   db.get(taskId)         // READ — table from Id<"tasks"> type of arg 0
   db.insert("tasks", x)  // WRITE — table is string literal arg 0
   db.patch(id, fields)   // WRITE — table from Id<"tasks"> type of arg 0
   db.replace(id, doc)    // WRITE — table from Id<"tasks"> type of arg 0
   db.delete(id)          // WRITE — table from Id<"tasks"> type of arg 0
   db.system.query(...)   // system table access — we ignore
   ```

3. **Follow tainted calls** — for each call expression in the handler body, check if any argument is a tainted symbol. If so:
   - Resolve the callee's declaration (may be in another file)
   - Map call-site arguments to declared parameters
   - Mark parameters that received tainted values as tainted in the new scope
   - Recursively analyze that function's body (increment depth)

4. **Depth limit** — stop at 3 hops. Configurable.

5. **Record unresolved** — emit a diagnostic when:
   - Callee can't be resolved (external package, dynamic dispatch)
   - Table name isn't a string literal and can't be resolved from types
   - Id type parameter is `Id<string>` or otherwise unresolvable
   - Cycle detected

### Phase 4: Table Extraction

For each `db.<method>` call:

**String-literal case** (`db.query("tasks")`, `db.insert("tasks", ...)`):
- Extract the string literal from the call argument

**Id-typed case** (`db.get(id)`, `db.patch(id, ...)`, etc.):
- Resolve the type of the Id argument via ts-morph's type checker
- Look for `Id<"tableName">` shape
- Extract the string literal type argument

**Dynamic case** (`db.query(tableName)` where `tableName` is a variable):
- Attempt simple symbol resolution (is the variable assigned a literal?)
- If unresolvable, emit diagnostic + mark function as partial confidence

### Phase 5: Output

The analyzer produces two artifacts:

**JSON map** — machine-readable, consumable from any tool:

```json
{
  "version": 1,
  "functions": {
    "tasks:list": {
      "type": "query",
      "visibility": "public",
      "reads": ["tasks"],
      "writes": [],
      "confidence": "full",
      "sourceFile": "convex/tasks.ts",
      "handlerLocation": { "line": 5, "column": 14 }
    }
  },
  "diagnostics": [
    {
      "severity": "warning",
      "function": "tasks:bulkProcess",
      "file": "convex/tasks.ts",
      "line": 42,
      "message": "Could not resolve table name in ctx.db.query(dynamicName)"
    }
  ]
}
```

**Typed TS module** — for consumers that want type-level integration:

```ts
// generated: convex-table-graph.generated.ts
export const tableGraph = {
  "tasks:list":   { reads: ["tasks"] as const, writes: [] as const, type: "query" },
  "tasks:create": { reads: [] as const, writes: ["tasks"] as const, type: "mutation" },
} as const
```

### Diagnostics Philosophy

**Diagnostics are local to the developer running the tool.** No telemetry, no phone-home. When the analyzer can't resolve something, it reports exactly what and where, so the developer can decide whether to:

1. Fix the code pattern (make the table name a string literal)
2. Add an explicit annotation (`writes: ["tasks"]` on the builder)
3. Accept partial confidence for that function

## Research Findings That Shaped This Design

### TanStack DB 0.6 Review
- Backend-agnostic client-side transactional query engine with SQLite WASM persistence
- Collections, live queries, optimistic updates, offline transactions
- Current integrations: PowerSync, ElectricSQL, Trailbase (all delta-based sync engines)
- No existing Convex integration

### PowerSync-Convex Integration
- Status: "In Progress" on PowerSync's roadmap
- Approach: consume Convex streaming exports as CDC source
- We are not building on PowerSync — direct adapter is the chosen path

### Automerge-Convex (Ian Macartney, Convex CTO)
- Pattern: Convex as opaque binary blob relay for Automerge CRDT data
- Schema is generic (`documentId, type, hash, data: v.bytes()`)
- Three functions total: submitSnapshot, submitChange, pullChanges
- Validates that Convex's sync primitive is valuable even stripped of structured data semantics
- Confirms Convex team views local-first as "bring your own CRDT" rather than native feature

### Convex's Optimistic Update API
- Query-cache patching, not data-layer merging
- `localStore.getQuery().setQuery()` per affected query
- Server always wins — optimistic state is discarded on subscription update
- This is the exact DX pain point the analyzer solves

### Convex Function Discovery
- All files in `convex/` except `_generated/`, `_deps/`, `schema.ts`, test files
- No general `_` prefix exclusion
- Functions identified at runtime via `func.isQuery`/`isMutation`/`isAction` markers
- Static detection via AST pattern matching on builder call expressions

### Convex's Reactive Graph
- Server-computed via execution-time read tracking (Rust implementation)
- Query functions are opaque TypeScript — can't be introspected for joins/filters
- Subscription granularity = query function, not row
- This is why we don't attempt to recreate Convex's query semantics client-side

## Alternatives Considered

### Runtime Instrumentation
Proxy `ctx.db`, run handlers with mock args, record table accesses. **Rejected** because control flow branches are invisible — `if (args.notify) { db.insert("notifications", ...) }` is missed if you only exercise the `notify=false` path. Static analysis sees both branches.

### Jelly (cs-au-dk/jelly)
General-purpose JS/TS call graph construction via flow-insensitive points-to analysis. **Rejected** because it's CLI-only (no programmatic API), heavyweight for our narrow problem, and solves a more general version of what we need. ts-morph's direct symbol resolution is sufficient for 90%+ of Convex code patterns.

### Manual Declarations
Require developers to declare `reads`/`writes` on each function. **Rejected as primary path** because it's the same DX friction as `withOptimisticUpdate`. Kept as an escape hatch for functions the analyzer can't resolve.

### Building TanStack DB Adapter First
Start with manual wiring, learn from real usage. **Rejected** because:
- The inference IS the point — manual wiring recreates Convex's existing optimistic update DX
- A "bring your own TanStack DB" consumer is niche; the optimistic updates helper has broader value
- Building the analyzer first lets us ship the high-value narrow product while learning about the broader use case

## Build Order

1. **`convex-table-graph`** — the analyzer (this package)
2. **Smart optimistic updates helper for Convex** — first consumer; highest leverage (works for any Convex app)
3. **Explore unifying with zodvex's discovery** — evaluate whether AST analysis can replace runtime import
4. **`tanstack-db-convex`** — offline-capable adapter that uses the graph

## Open Questions

1. **Id type resolution reliability** — how well does ts-morph resolve `Id<"tableName">` type parameters across module boundaries? Needs a spike.

2. **Wrapper builder detection** — how do we recognize that `zQuery(...)` returns a Convex query? Options:
   - Configuration file lists wrapper names
   - Follow the wrapper's implementation to confirm it calls `query()` internally
   - Require builders to have a recognizable marker (e.g., a comment or type alias)

3. **Incremental analysis** — reanalyze only changed files for faster dev loops, or full scan every time? Full scan is simpler for v1.

4. **Monorepo support** — what if Convex functions import helpers from a sibling package? Depth limit handles most cases, but boundary handling may need explicit config.

5. **Output location** — `_generated/convex-table-graph.ts`? `convex-table-graph.generated.ts`? Outside `convex/`? The sidenote from the design discussion: existing zodvex codegen at `_zodvex/` works today but doesn't follow Convex's "multiple dots" exclusion convention. New codegen output should likely use `convex-table-graph.generated.ts` or equivalent.

## Package Boundaries

```
packages/
├── convex-table-graph/   # Static analyzer. No client runtime deps.
└── tanstack-db-convex/   # Deferred. Will consume the graph.
```

Neither package depends on zodvex. They live in this monorepo temporarily for development convenience; both are candidates for extraction to standalone repos once stable.

## References

- [TanStack DB 0.6 Release Notes](https://tanstack.com/blog/tanstack-db-0.6-app-ready-with-persistence-and-includes)
- [Convex Optimistic Updates Docs](https://docs.convex.dev/client/react/optimistic-updates)
- [Automerge-Convex Quickstart](https://github.com/ianmacartney/automerge-convex-quickstart)
- [PowerSync Roadmap — Convex support](https://roadmap.powersync.com/c/142-support-for-convex)
- [Aaron Boodman on server-authority vs decentralized sync](https://x.com/aboodman/status/1843045692736204802)
- Convex's own function discovery: `convex/dist/esm/bundler/index.js` — `entryPoints()` function
- zodvex's runtime discovery: `packages/zodvex/src/public/codegen/discover.ts`
