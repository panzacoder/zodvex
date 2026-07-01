# zodvex docs

This tree holds two kinds of documents. Keeping them separate matters because the
**durable** docs are the source for the public documentation site, while the **ephemeral**
ones are working artifacts that get cleared regularly.

## Durable docs — public-facing, kept in sync (docs-site candidates)

These describe what zodvex *is* and *does*. They should read cleanly for an external reader
and stay current with the shipped API. Treat them as the canonical source when publishing the
docs site.

| Path | What it is |
| --- | --- |
| [`positioning.md`](./positioning.md) | Canonical positioning statement — what zodvex is / is not. Change here first, then thread through README/CLAUDE/ARCHITECTURE. |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Layered design and source-tree map. |
| [`roadmap.md`](./roadmap.md) | Public roadmap — direction at the adopter's level. |
| [`guide/`](./guide/) | User-facing feature guides (`zx`, codecs, date handling, rules & audit, streams, codegen, forms, …). |
| [`migration/`](./migration/) | Version migration guides. |
| `../README.md`, `../MIGRATION.md`, `../CHANGELOG.md` | Repo-root durable docs. |

`decisions/` sits between the two: durable *rationale* (why we chose X), useful long-term but
internal-facing rather than docs-site material.

## Ephemeral docs — internal, cleared regularly

In-flight implementation plans and design specs. They capture how a specific change was
planned and are **not** kept in sync with the shipped code — expect them to be stale, and
prune them once the work lands.

| Path | What it is |
| --- | --- |
| [`superpowers/plans/`](./superpowers/) | Implementation plans for specific initiatives. Ephemeral — clear once shipped. |
| [`superpowers/specs/`](./superpowers/) | Design specs for the same. Ephemeral. |
| [`planning/`](./planning/) | Cross-cutting synthesis and proposals (e.g. `state-of-zodvex.md`, integration sketches). Longer-lived than superpowers plans, but still internal. |
| [`issues/`](./issues/) | Tracked-but-not-in-flight design issues (feed the roadmap). |
| [`archive/`](./archive/) | Historical plans/todos. Being pruned — anything with live intent is promoted to `roadmap.md` + `planning/` first. |

## Working rule

- Land a user-facing capability → update or add a **guide** (durable) and, if direction
  shifts, **roadmap.md**.
- Finish an initiative → its `superpowers/` plan/spec becomes prunable.
- Never let a durable doc drift: if the API changed, the guide/positioning/architecture change
  in the same PR.
