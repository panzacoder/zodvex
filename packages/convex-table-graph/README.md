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

## Intended consumers

- **Smart optimistic updates helper for Convex** — auto-invalidate queries on mutation (primary target)
- **`tanstack-db-convex`** — offline/persistence adapter
- **Other tooling** — documentation, visualization, linting

The analyzer itself has no opinion about how the graph is consumed.
