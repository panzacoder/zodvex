# convex-table-graph

Static analyzer that extracts function-to-table dependency relationships from Convex projects.

**Status:** Work in progress. Not published.

## What it does

Given a Convex project, produces a map of every query, mutation, and action to the tables it reads and writes:

```json
{
  "tasks:list":    { "type": "query",    "reads": ["tasks"],                       "writes": [] },
  "tasks:create":  { "type": "mutation", "reads": [],                              "writes": ["tasks"] },
  "tasks:archive": { "type": "mutation", "reads": ["tasks"],                       "writes": ["tasks", "auditLog"] }
}
```

This map is the missing piece that enables automatic optimistic updates in Convex applications — when a mutation fires, any consumer can look up which queries are affected without the developer wiring relationships manually.

## Why

Convex's "realtime just works" magic breaks in exactly one place: [optimistic updates](https://docs.convex.dev/client/react/optimistic-updates). The existing API requires manual query/mutation wiring, which is the only part of Convex that asks developers to reason about the reactive graph explicitly.

`convex-table-graph` closes that gap by extracting what Convex's server already knows and exposing it to client tooling.

See [DESIGN.md](./DESIGN.md) for the full design document, research findings, and architectural decisions.

## How it works

Pure static analysis via ts-morph. No runtime, no Convex deployment required, no code execution.

1. Discover files in `convex/` using the same rules as Convex's bundler
2. Find exports wrapped in `query()` / `mutation()` / `action()` builders
3. Walk the handler body looking for `ctx.db.*("tableName")` calls
4. Follow function calls that receive `ctx`, `ctx.db`, or `db` as arguments (bounded depth)
5. Resolve table names from string literals or `Id<"table">` type parameters
6. Emit a dependency graph + diagnostics for anything unresolved

## Usage

### CLI

```bash
# Analyze ./convex and print JSON
convex-table-graph

# Analyze a specific directory and write to a file
convex-table-graph ./examples/my-app/convex -o table-graph.json

# Emit a typed TS module instead of JSON
convex-table-graph -o convex-table-graph.generated.ts -f ts

# Register custom wrapper builders (repeatable, <kind>=<name>[,<name>...])
convex-table-graph --builder query=zq,myQuery --builder mutation=zm

# Point at a specific tsconfig and deepen the taint walk
convex-table-graph --tsconfig ./convex/tsconfig.json --max-depth 5
```

### Config file

Instead of flags, put options in `convex-table-graph.config.{json,mjs,cjs,js}` — auto-discovered in the cwd, then next to the convex/ directory (or pass `-c/--config <path>` explicitly). CLI flags win over config values; builder lists are unioned.

```json
{
  "builders": {
    "query": ["zq"],
    "mutation": ["zm"],
    "internalMutation": ["zim"]
  },
  "dbFactories": ["zodvexStream"],
  "overrides": {
    "retention:processTable": { "reads": ["messages"], "writes": ["messages"] }
  },
  "maxDepth": 3,
  "tsConfigFilePath": "./convex/tsconfig.json"
}
```

Relative paths in a config file resolve against the config file's location.

- **`dbFactories`** — names of free functions that return a db-like object when passed a db (e.g. zodvex's `zodvexStream`). Calls like `zodvexStream(ctx.db, schema).query("visits")` then record a read of `visits` instead of an unresolvable-callee diagnostic. Also available as the repeatable `--db-factory` flag.
- **`overrides`** — the escape hatch for code static analysis genuinely can't resolve (dynamic table names, external callees). Declared `reads`/`writes` are unioned with what the analyzer found, the function is promoted to full confidence, and its diagnostics are dropped — you're vouching for completeness. An override whose path matches no function emits an `unknown-override` warning so typos surface. Config-file only.

### Programmatic API

```ts
import { analyze } from 'convex-table-graph'

const graph = analyze({
  convexDir: './convex',
  builders: {
    query: ['zq'],
    mutation: ['zm'],
    action: ['za'],
    internalQuery: ['ziq'],
    internalMutation: ['zim'],
    internalAction: ['zia']
  },
  maxDepth: 3 // default: 3
})

for (const [path, info] of Object.entries(graph.functions)) {
  console.log(`${path} reads=${info.reads} writes=${info.writes}`)
}
```

### Result orderings

For query functions, the analyzer also extracts how list-shaped results are ordered, when a complete `db.query('t')…collect/take/paginate` chain is visible:

```jsonc
"tasks:recent": {
  "kind": "query",
  "reads": ["tasks"],
  "resultOrderings": [{ "table": "tasks", "direction": "desc", "byCreationTime": true }]
}
```

- `direction` comes from a literal `.order('asc'|'desc')` call (default `asc`).
- `byCreationTime` is true when the chain uses the default index (or `by_creation_time` explicitly) — the only case where a newly inserted doc's position is statically knowable. Custom-index chains are recorded with `byCreationTime: false`.
- Extraction is conservative: broken chains (variable assignments, ternaries), dynamic `.order()` arguments, search indexes, unknown chain methods, and disagreeing chains on the same table all suppress the entry. Single-doc terminators (`first`/`unique`) neither contribute nor invalidate.

Consumers (e.g. convex-auto-optimistic) use this to place optimistic inserts per query instead of requiring a per-mutation hint.

### Patterns recognized

- `ctx.db.query("table")`, `.insert("table", doc)` — direct string-literal tables
- `ctx.db.patch(id, ...)`, `.replace(id, ...)`, `.delete(id)`, `.get(id)` — table from `Id<"table">` type parameter
- `ctx.db.get("table", id)`, `.patch("table", id, ...)`, etc. — table-name-first overloads (zodvex codec db / newer convex)
- `const { db } = ctx` / `({ db }, args) => ...` — destructuring propagation
- `const secureDb = ctx.db.withRules(...)` — db-wrapping method pattern (any non-data-method call on db produces a new tainted db-like)
- Cross-file helpers: `await helper(ctx.db, ...)` — taint propagates through function-call boundaries up to `maxDepth`
- Parametric helpers: `getX(ctx.db, 'visits', id)` calling `db.get(table, id)` — string literals propagate into followed helpers per call site (the same helper called with `'tasks'` and `'users'` records both)

### Diagnostics

When the analyzer can't resolve something, it emits a diagnostic with file+line and a code. Common unresolvable patterns:

- `unresolved-db-arg` — a dynamic table name (`ctx.db.query(tableName)`) or an `any`-typed Id
- `max-depth` — a helper chain too deep to follow
- `unresolvable-callee` — a call where the target can't be statically determined

Diagnostics are written to stderr. The function affected is marked with `confidence: "partial"` in the graph.

## Intended consumers

- **Smart optimistic updates helper for Convex** — auto-invalidate queries on mutation (primary target)
- **`tanstack-db-convex`** — offline/persistence adapter
- **Other tooling** — documentation, visualization, linting

The analyzer itself has no opinion about how the graph is consumed.
