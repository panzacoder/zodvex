# What zodvex is

**zodvex is a codec-aware data layer for Convex, built on Zod v4.** It preserves
Convex's exact optional/nullable validator semantics, and its defining capability is a
codec-aware `ctx.db` — `Date`, typed IDs, and custom codecs encode/decode automatically
at the database boundary, with row-level rules (`.withRules()`) and audit hooks
(`.audit()`) on the same wrapped db. You configure it once with `initZodvex` and get
correct builders back.

**What it is not:** a function-composition or middleware framework. There is no builder
chain to assemble — the "middleware" is the ambient codec-aware db, wired once via
`initZodvex`. Validator *mapping* (Zod → Convex) is the foundation it stands on (via
`convex-helpers`), not the product.

---

This file is the canonical positioning statement for zodvex. `CLAUDE.md`, `README.md`,
and `docs/ARCHITECTURE.md` all lead with the same framing and point back here. Keep them
in sync: if the positioning changes, change it here first, then thread it through those
three docs.

## Why the framing matters

The easy mistake is to describe zodvex as "Zod → Convex validator mapping with nicer
ergonomics." That is the *least* differentiated way to describe it — plain
`convex-helpers` already maps validators — and it invites readers to file zodvex in the
same category as any other "Zod + Convex validation" library. It is not in that category.

Lead with the layer that is actually distinct:

1. **Codec-aware `ctx.db`.** Reads decode and writes encode automatically at the database
   boundary. `zx.date()` is stored as a `v.float64()` timestamp but handlers work with
   `Date`. `zx.codec(...)` extends this to arbitrary wire ↔ runtime transforms. This is
   the product.
2. **Rules and audit on the same wrapped db.** `.withRules()` (row-level security) and
   `.audit()` (afterRead/afterWrite hooks) decorate the same codec-aware db object and
   see *decoded* document types — `Date`, branded ids — not wire values.
3. **Configure-once setup.** `initZodvex(schema, builders)` returns the mainline builders
   (`zq`, `zm`, `za`, `ziq`, `zim`, `zia`) with the codec-aware db already wired in. There
   is no per-function composition step to remember.
4. **Correct optional/nullable semantics.** `.optional()` → `v.optional(T)`,
   `.nullable()` → `v.union(T, v.null())`, both → `v.optional(v.union(T, v.null()))`.
   Supporting detail, not the headline.

## The non-goal, stated plainly

zodvex is **not** a function-composition framework. It has no onion-style `.use()`
middleware chain, no reusable-callable builder graph, no plugin `.extend()` surface. If
you are looking for that model, that is a different kind of library (e.g.
[fluent-convex](https://github.com/mikecann/fluent-convex)). zodvex's answer to
"middleware" is the ambient codec-aware data layer installed by `initZodvex` — the two
approaches live at different layers and can even compose (see
`docs/planning/fluent-convex-integration.md`).

## One-liner

> A codec-aware data layer for Convex, built on Zod v4 — automatic `Date`/id/codec
> encode-decode at `ctx.db`, with row-level rules and audit, wired once via `initZodvex`.
