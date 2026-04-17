# tanstack-db-convex

**Status:** Deferred. Not yet implemented.

This package will provide a TanStack DB adapter for Convex — enabling local-first persistence, offline reads/writes, and optimistic updates on top of Convex's reactive subscriptions.

## Current status

Design work is captured in [`packages/convex-table-graph/DESIGN.md`](../convex-table-graph/DESIGN.md). Implementation is intentionally deferred until:

1. `convex-table-graph` (the dependency graph analyzer) ships
2. A simpler consumer — a smart optimistic updates helper for vanilla Convex — validates the graph output in production
3. We've learned enough from real usage to know whether TanStack DB is the right client runtime or whether something simpler (e.g., IndexedDB-backed subscription cache + mutation queue) is a better fit

## Why the delay

TanStack DB's design assumes delta-based sync and a relational query engine over cached data. Convex pushes full query snapshots, and its server-authoritative model means client-side joins risk drift from the server's reactive graph. The adapter is viable, but the "safe" version uses only ~30% of what TanStack DB offers.

Building `convex-table-graph` first de-risks this decision: the graph is valuable regardless of which client runtime we end up using.

See the [design document](../convex-table-graph/DESIGN.md) for the full architectural rationale.
